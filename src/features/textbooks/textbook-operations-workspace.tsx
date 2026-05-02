"use client";

import { Fragment, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Barcode,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ClipboardCheck,
  PackageCheck,
  Plus,
  Pencil,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  Truck,
  X,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

import {
  buildTextbookMonthlyClosing,
  buildTextbookSaleDraft,
  filterStockMovesForClosing,
  getRecordId,
  getTextbookSalePrice,
  getTextbookActionErrorMessage,
  getTextbookTitle,
  groupPurchaseLinesByStatus,
  groupSaleLinesByStatus,
  listIds,
  normalizeBarcodeValue,
} from "./textbook-ledger.js";
import { textbookService } from "./textbook-service";
import {
  TEXTBOOK_GRADE_OPTIONS,
  TEXTBOOK_SCHOOL_LEVEL_OPTIONS,
  TextbookSubSubjectSettingRecord,
  buildTextbookCategoryValue,
  getGradeOptionsForSchoolLevel,
  getSubSubjectOptionsForSubject,
  getTextbookCategoryLabel,
  getTextbookGradeLabel,
  getTextbookGradeLevel,
  getTextbookSchoolLevel,
  getTextbookSchoolLevelLabel,
  getTextbookSubSubject,
  mergeTextbookSubSubjectSettings,
} from "./textbook-taxonomy";

type Row = Record<string, unknown>;
type InventoryFilter = "all" | "shortage" | "surplus" | "unused" | "negative";
type InventoryAuditFilter = "recommended" | "pending" | "done" | "all";
type TextbookQualityFilter =
  | "all"
  | "attention"
  | "duplicate"
  | "missingCode"
  | "missingPublisher"
  | "missingCategory"
  | "missingPrice"
  | "subjectMismatch"
  | "inactive";
type TextbookAmountMode = "salePrice" | "stockValue";
type PurchaseBoardScope = "active" | "recent" | "all";
type PurchaseRequestFilter = "all" | "unregistered" | "orderable";
type PurchaseOrderFilter = "all" | "waiting" | "partial";
type SalesProcessFilter = "all" | "waiting" | "issued";
type TextbookOpsQueueKey = "unregistered" | "order" | "partial" | "issue" | "stockRisk";
type PurchaseKanbanStatus = "requested" | "ordered" | "partially_received" | "received";
type PurchaseKanbanDraft = {
  textbookId: string;
  requestedTextbookTitle: string;
  classId: string;
  supplierId: string;
  locationId: string;
  requestBy: string;
  requestedQuantity: string;
  orderedQuantity: string;
  receivedQuantity: string;
  unitCost: string;
  statementNumber: string;
  memo: string;
};
type InventoryCountRow = {
  source: Row;
  id: string;
  title: string;
  publisher: string;
  locationId: string;
  locationName: string;
  currentQuantity: number;
  latestCountAt: string;
  daysSinceLatestCount: number;
  isCountedThisCycle: boolean;
  isRecommended: boolean;
  status: InventoryAuditFilter;
  reason: string;
  dueLabel: string;
};

const subjectOptions = [
  { value: "english", label: "영어" },
  { value: "math", label: "수학" },
  { value: "other", label: "기타" },
];

const subjectAliases: Record<string, string> = {
  english: "english",
  "영어": "english",
  math: "math",
  "수학": "math",
  other: "other",
  "기타": "other",
};

const statusOptions = [
  { value: "active", label: "사용중" },
  { value: "inactive", label: "미사용" },
];

const statusAliases: Record<string, string> = {
  active: "active",
  "사용중": "active",
  inactive: "inactive",
  "미사용": "inactive",
};

const emptyMasterForm = {
  id: "",
  title: "",
  subject: "english",
  schoolLevel: "",
  gradeLevel: "",
  subSubject: "",
  category: "",
  publisher: "",
  isbn13: "",
  barcode: "",
  price: "",
  status: "active",
};

const emptyBulkTextbookPatch = {
  subject: "keep",
  category: "",
  publisher: "",
  price: "",
  status: "keep",
};

const emptyPurchaseForm = {
  requestStage: "request",
  textbookId: "",
  requestedTextbookTitle: "",
  classId: "",
  supplierId: "",
  locationId: "",
  requestBy: "",
  requestedQuantity: "1",
  orderedQuantity: "",
  receivedQuantity: "",
  unitCost: "",
  statementNumber: "",
  memo: "",
};

const inventoryFilterLabels: Record<InventoryFilter, string> = {
  all: "전체",
  shortage: "부족",
  surplus: "과잉",
  unused: "재고 없음",
  negative: "마이너스",
};

const INVENTORY_COUNT_CYCLE_DAYS = 30;
const INVENTORY_LOW_STOCK_THRESHOLD = 3;

const inventoryAuditFilterLabels: Record<InventoryAuditFilter, string> = {
  recommended: "할 일",
  pending: "대기",
  done: "완료",
  all: "전체",
};

const textbookQualityFilterLabels: Record<TextbookQualityFilter, string> = {
  all: "정리 전체",
  attention: "정리 필요",
  duplicate: "중복",
  missingCode: "코드 없음",
  missingPublisher: "출판사 없음",
  missingCategory: "분류 없음",
  missingPrice: "가격 없음",
  subjectMismatch: "과목 확인",
  inactive: "미사용",
};

const textbookTabTriggerClassName =
  "gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm";
const dialogFooterClassName =
  "sticky bottom-0 -mx-6 -mb-6 mt-1 flex justify-end gap-2 border-t bg-background/95 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80";

const purchaseStageLabels: Record<string, string> = {
  request: "요청 접수",
  order: "공급처 주문",
  receive: "입고 처리",
};

const purchaseBoardScopeLabels: Record<PurchaseBoardScope, string> = {
  active: "진행중",
  recent: "최근 입고",
  all: "전체",
};

const purchaseOrderFilterLabels: Record<PurchaseOrderFilter, string> = {
  all: "전체 입고",
  waiting: "입고 대기",
  partial: "부분입고",
};

const saleStatusLabels: Record<string, string> = {
  charged: "출고 대기",
  issued: "출고 완료",
  cancelled: "취소",
  returned: "반품",
};

type TextbookOperationsData = {
  textbooks: Row[];
  publishers: Row[];
  suppliers: Row[];
  publisherSupplierLinks: Row[];
  textbookSubSubjectSettings: Row[];
  locations: Row[];
  purchaseOrders: Row[];
  purchaseOrderLines: Row[];
  stockMoves: Row[];
  sales: Row[];
  saleLines: Row[];
  stockCounts: Row[];
  monthlyClosings: Row[];
  students: Row[];
  classes: Row[];
  teacherCatalogs: Row[];
  inventory: Row[];
  defaultLocationId: string;
  currentMonth: string;
  missingTables: string[];
  isSchemaReady: boolean;
};

const emptyData: TextbookOperationsData = {
  textbooks: [],
  publishers: [],
  suppliers: [],
  publisherSupplierLinks: [],
  textbookSubSubjectSettings: [],
  locations: [],
  purchaseOrders: [],
  purchaseOrderLines: [],
  stockMoves: [],
  sales: [],
  saleLines: [],
  stockCounts: [],
  monthlyClosings: [],
  students: [],
  classes: [],
  teacherCatalogs: [],
  inventory: [],
  defaultLocationId: "",
  currentMonth: "",
  missingTables: [],
  isSchemaReady: true,
};

function text(value: unknown) {
  return String(value || "").trim();
}

function normalizeOptionValue(value: unknown, aliases: Record<string, string>, fallback: string) {
  const raw = text(value);
  return aliases[raw] || aliases[raw.toLowerCase()] || fallback;
}

function normalizeSubjectValue(value: unknown) {
  return normalizeOptionValue(value, subjectAliases, "other");
}

function getSubjectLabel(value: unknown) {
  const raw = text(value);
  const normalized = normalizeSubjectValue(raw);
  return subjectOptions.find((option) => option.value === normalized)?.label || raw || "-";
}

function getPublisherLabel(row: Row) {
  return text(row.publisher) || "미분류";
}

function getCategoryLabel(row: Row) {
  return getTextbookCategoryLabel(row);
}

function getTextbookTitleKey(row: Row) {
  return getTextbookTitle(row).trim().replace(/\s+/g, " ").toLowerCase();
}

function getTaxonomyCategoryLabel(row: Row) {
  return getTextbookCategoryLabel(row);
}

function hasTextbookTaxonomy(row: Row) {
  return Boolean(getTextbookSchoolLevel(row) || getTextbookGradeLevel(row) || getTextbookSubSubject(row) || text(row.category));
}

function hasTextbookSubjectMismatch(row: Row) {
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

function getTextbookQualityIssues(row: Row, duplicateTitleKeys: Set<string>) {
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

function getTextbookQualityIssueLabels(issues: ReturnType<typeof getTextbookQualityIssues>) {
  const labels: Array<{ label: string; tone: "default" | "warning" | "danger" | "muted" }> = [];
  if (issues.subjectMismatch) labels.push({ label: "과목 확인", tone: "danger" });
  if (issues.duplicate) labels.push({ label: "중복", tone: "warning" });
  if (issues.missingPrice) labels.push({ label: "가격 없음", tone: "muted" });
  if (issues.missingPublisher) labels.push({ label: "출판사 없음", tone: "muted" });
  if (issues.missingCategory) labels.push({ label: "분류 없음", tone: "muted" });
  if (issues.missingCode) labels.push({ label: "코드 없음", tone: "muted" });
  if (issues.inactive) labels.push({ label: "미사용", tone: "default" });
  return labels;
}

function hasTextbookQualityIssue(row: Row, duplicateTitleKeys: Set<string>) {
  const issues = getTextbookQualityIssues(row, duplicateTitleKeys);
  return (
    issues.duplicate ||
    issues.missingCode ||
    issues.missingPublisher ||
    issues.missingCategory ||
    issues.missingPrice ||
    issues.subjectMismatch ||
    issues.inactive
  );
}

function getTextbookQualityScore(row: Row, duplicateTitleKeys: Set<string>) {
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

function matchesTextbookQualityFilter(row: Row, filter: TextbookQualityFilter, duplicateTitleKeys: Set<string>) {
  if (filter === "all") return true;
  if (filter === "attention") return hasTextbookQualityIssue(row, duplicateTitleKeys);
  const issues = getTextbookQualityIssues(row, duplicateTitleKeys);
  return Boolean(issues[filter]);
}

function getTextbookGroupLabel(row: Row) {
  return getSubjectLabel(row.subject);
}

function compareTextbookGroupLabels(left: string, right: string) {
  const orderedLabels = subjectOptions.map((option) => option.label);
  const leftIndex = orderedLabels.indexOf(left);
  const rightIndex = orderedLabels.indexOf(right);
  const safeLeftIndex = leftIndex === -1 ? orderedLabels.length : leftIndex;
  const safeRightIndex = rightIndex === -1 ? orderedLabels.length : rightIndex;
  if (safeLeftIndex !== safeRightIndex) return safeLeftIndex - safeRightIndex;
  return left.localeCompare(right, "ko", { numeric: true });
}

function normalizeStatusValue(value: unknown) {
  return normalizeOptionValue(value, statusAliases, "active");
}

function numberValue(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatCurrency(value: unknown) {
  const amount = numberValue(value);
  if (!amount) return "-";
  return `${new Intl.NumberFormat("ko-KR").format(amount)}원`;
}

function formatQuantity(value: unknown) {
  return new Intl.NumberFormat("ko-KR").format(numberValue(value));
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function getStudentName(row: Row) {
  return text(row.name || row.student_name || row.studentName || row.id);
}

function getClassName(row: Row) {
  return text(row.name || row.class_name || row.className || row.title || row.id);
}

function getTeacherName(row: Row) {
  return text(row.name || row.teacher_name || row.teacherName || row.title || row.id);
}

function splitTeacherNames(value: unknown) {
  return text(value)
    .split(/[,/·|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getDefaultTeacherForClass(classRecord: Row | undefined, teacherCatalogs: Row[]) {
  if (!classRecord) return "";

  const teacherIds = listIds(
    classRecord.teacher_id ||
    classRecord.teacherId ||
    classRecord.teacher_ids ||
    classRecord.teacherIds ||
    classRecord.teacher_catalog_id ||
    classRecord.teacherCatalogId,
  );

  for (const teacherId of teacherIds) {
    const teacher = teacherCatalogs.find((item) => getRecordId(item) === teacherId);
    const teacherName = getTeacherName(teacher || {});
    if (teacherName) return teacherName;
  }

  return splitTeacherNames(
    classRecord.teacher ||
    classRecord.teacher_name ||
    classRecord.teacherName ||
    classRecord.teacher_names ||
    classRecord.teacherNames,
  )[0] || "";
}

function getLocationName(locations: Row[], id: string) {
  const match = locations.find((location) => getRecordId(location) === id || text(location.code) === id);
  return text(match?.name || match?.code || id);
}

function findLocationByCode(locations: Row[], code: string) {
  return locations.find((location) => text(location.code).toLowerCase() === code || getRecordId(location) === code);
}

function inferClassLocationId(classRecord: Row | undefined, locations: Row[]) {
  if (!classRecord) return "";
  const classroom = text(
    classRecord.classroom ||
      classRecord.classroom_name ||
      classRecord.classroomName ||
      classRecord.room ||
      classRecord.location,
  );
  if (!classroom) return "";

  if (/(별관|별\s*\d|별\d)/.test(classroom)) {
    return text(getRecordId(findLocationByCode(locations, "annex") || {}) || findLocationByCode(locations, "annex")?.id);
  }

  if (/(본관|본\s*\d|본\d)/.test(classroom)) {
    return text(getRecordId(findLocationByCode(locations, "main") || {}) || findLocationByCode(locations, "main")?.id);
  }

  return "";
}

function getSupplierName(suppliers: Row[], id: string) {
  const match = suppliers.find((supplier) => getRecordId(supplier) === id || text(supplier.name) === id);
  return text(match?.name || id);
}

function getConfiguredSupplierIdForTextbook(textbook: Row | undefined, publisherSupplierLinks: Row[]) {
  if (!textbook) return "";
  const directSupplierId = text(
    textbook.default_supplier_id ||
      textbook.defaultSupplierId ||
      textbook.supplier_id ||
      textbook.supplierId,
  );
  if (directSupplierId) return directSupplierId;

  const publisherId = text(textbook.publisher_id || textbook.publisherId);
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

function normalizeTextbookLookup(value: unknown) {
  return text(value).replace(/\s+/g, " ").toLowerCase();
}

function getTextbookById(textbooks: Row[], id: string) {
  const reference = text(id);
  if (!reference) return undefined;

  const exactMatch = textbooks.find((textbook) => getRecordId(textbook) === reference);
  if (exactMatch) return exactMatch;

  const normalizedReference = normalizeTextbookLookup(reference);
  return textbooks.find((textbook) => {
    const candidates = [
      getTextbookTitle(textbook),
      textbook.name,
      textbook.isbn13,
      textbook.isbn,
      textbook.barcode,
    ];
    return candidates.some((candidate) => normalizeTextbookLookup(candidate) === normalizedReference);
  });
}

function getRequestedTextbookTitle(line: Row) {
  return text(line.requested_textbook_title || line.requestedTextbookTitle || line.textbook_title || line.textbookTitle);
}

function getPurchaseTextbookTitle(line: Row, textbook: Row | undefined) {
  return textbook ? getTextbookTitle(textbook) : getRequestedTextbookTitle(line) || text(line.textbook_id || line.textbookId) || "-";
}

function buildKyoboSearchUrl(title: string) {
  return `https://search.kyobobook.co.kr/search?keyword=${encodeURIComponent(title)}`;
}

function getPurchaseLineOrder(line: Row, ordersById: Map<string, Row>) {
  return ordersById.get(text(line.purchase_order_id || line.purchaseOrderId));
}

function getClassById(classes: Row[], id: string) {
  return classes.find((classItem) => getRecordId(classItem) === id);
}

function getStudentsByClass(classRecord: Row | undefined, students: Row[]) {
  if (!classRecord) return [];
  const studentIds = listIds(classRecord.student_ids || classRecord.studentIds);
  const studentsById = new Map(students.map((student) => [getRecordId(student), student]));
  return studentIds.map((id) => studentsById.get(id) || { id, name: id });
}

function getClassStudentCount(classRecord: Row | undefined, students: Row[]) {
  return getStudentsByClass(classRecord, students).length;
}

function getPurchaseQuantityClassFit(requestedQuantity: unknown, studentCount: number) {
  const requested = numberValue(requestedQuantity);
  const difference = requested - studentCount;
  if (!studentCount) {
    return { label: "수업 미선택", tone: "default" as const, difference };
  }
  if (difference < 0) {
    return { label: `${formatQuantity(Math.abs(difference))}권 부족`, tone: "danger" as const, difference };
  }
  if (difference > Math.max(2, Math.ceil(studentCount * 0.15))) {
    return { label: `${formatQuantity(difference)}권 여유`, tone: "warning" as const, difference };
  }
  return { label: difference > 0 ? `${formatQuantity(difference)}권 여유` : "적정", tone: "good" as const, difference };
}

function getInventoryQuantity(inventoryRow: Row | undefined, locationId: string) {
  const locationQuantities = (inventoryRow?.locationQuantities || {}) as Record<string, unknown>;
  if (!locationId) return numberValue(inventoryRow?.totalQuantity);
  return numberValue(locationQuantities[locationId]);
}

function getInventoryCountDraftKey(textbookId: string, locationId: string) {
  return `${textbookId}:${locationId}`;
}

function getInventoryCountedAt(row: Row) {
  return text(row.counted_at || row.countedAt || row.created_at || row.createdAt);
}

function getDaysSince(value: unknown) {
  const rawValue = text(value);
  if (!rawValue) return Number.POSITIVE_INFINITY;
  const time = new Date(rawValue).getTime();
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - time) / 86_400_000);
}

function getLatestStockCount(stockCounts: Row[], textbookId: string, locationId: string) {
  return stockCounts
    .filter((count) => (
      text(count.textbook_id || count.textbookId) === textbookId &&
      text(count.location_id || count.locationId) === locationId
    ))
    .sort((left, right) => new Date(getInventoryCountedAt(right)).getTime() - new Date(getInventoryCountedAt(left)).getTime())[0];
}

function getInventoryDueLabel(latestCountAt: string, daysSinceLatestCount: number) {
  if (!latestCountAt) return "실사 이력 없음";
  if (!Number.isFinite(daysSinceLatestCount)) return "실사일 확인 필요";
  if (daysSinceLatestCount >= INVENTORY_COUNT_CYCLE_DAYS) {
    return `${formatQuantity(daysSinceLatestCount)}일 경과`;
  }
  return `${formatQuantity(INVENTORY_COUNT_CYCLE_DAYS - daysSinceLatestCount)}일 남음`;
}

function getInventoryRecommendationReason(
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

function buildInventoryCountRows({
  rows,
  stockCounts,
  locations,
  locationId,
}: {
  rows: Row[];
  stockCounts: Row[];
  locations: Row[];
  locationId: string;
}) {
  return rows.map((row): InventoryCountRow => {
    const id = getRecordId(row);
    const latestCount = getLatestStockCount(stockCounts, id, locationId);
    const latestCountAt = getInventoryCountedAt(latestCount || {});
    const daysSinceLatestCount = getDaysSince(latestCountAt);
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

function isActiveTextbook(row: Row) {
  return normalizeStatusValue(row.status || row.state) === "active";
}

function inventoryTone(totalQuantity: number) {
  if (totalQuantity < 0) return "border-red-300 bg-red-50 text-red-700";
  if (totalQuantity === 0) return "border-zinc-300 bg-zinc-50 text-zinc-600";
  if (totalQuantity <= 3) return "border-amber-300 bg-amber-50 text-amber-700";
  return "border-emerald-300 bg-emerald-50 text-emerald-700";
}

function matchesInventoryFilter(row: Row, filter: InventoryFilter) {
  const totalQuantity = numberValue(row.totalQuantity);
  if (filter === "negative") return totalQuantity < 0;
  if (filter === "unused") return totalQuantity === 0;
  if (filter === "shortage") return totalQuantity < 0 || (totalQuantity > 0 && totalQuantity <= 3);
  if (filter === "surplus") return totalQuantity >= 20;
  return true;
}

function buildTextbookOpsMetrics(data: Pick<TextbookOperationsData, "textbooks" | "purchaseOrders" | "purchaseOrderLines" | "saleLines" | "sales" | "inventory">) {
  const purchaseOrdersById = new Map(data.purchaseOrders.map((order) => [getRecordId(order), order]));
  const salesById = new Map(data.sales.map((sale) => [getRecordId(sale), sale]));
  const metrics = {
    requestCount: 0,
    unregisteredRequestCount: 0,
    orderNeededCount: 0,
    receivingBacklogCount: 0,
    partialReceiptCount: 0,
    issueWaitingCount: 0,
    stockRiskCount: 0,
  };

  for (const line of data.purchaseOrderLines) {
    const order = getPurchaseLineOrder(line, purchaseOrdersById);
    const status = text(line.status || order?.status || "requested");
    const requestedQuantity = numberValue(line.requested_quantity || line.requestedQuantity);
    const orderedQuantity = numberValue(line.ordered_quantity || line.orderedQuantity);
    const receivedQuantity = numberValue(line.received_quantity || line.receivedQuantity);
    const requestedTitle = getRequestedTextbookTitle(line);
    const hasMasterTextbook = Boolean(getTextbookById(data.textbooks, text(line.textbook_id || line.textbookId) || requestedTitle));

    if (status === "requested") {
      metrics.requestCount += 1;
      if (hasMasterTextbook) {
        metrics.orderNeededCount += 1;
      } else {
        metrics.unregisteredRequestCount += 1;
      }
    }

    if ((status === "ordered" || status === "partially_received") && Math.max(orderedQuantity, requestedQuantity) > receivedQuantity) {
      metrics.receivingBacklogCount += 1;
    }
    if (status === "partially_received" || (orderedQuantity > 0 && receivedQuantity > 0 && receivedQuantity < orderedQuantity)) {
      metrics.partialReceiptCount += 1;
    }
  }

  for (const line of data.saleLines) {
    const sale = salesById.get(text(line.sale_id || line.saleId));
    const status = text(line.status || sale?.status || "charged");
    if (status === "charged" || status === "paid") {
      metrics.issueWaitingCount += 1;
    }
  }

  metrics.stockRiskCount = data.inventory.filter(
    (row) => isActiveTextbook(row) && (matchesInventoryFilter(row, "shortage") || matchesInventoryFilter(row, "negative")),
  ).length;

  return metrics;
}

function purchaseStatusLabel(status: unknown, orderedQuantity: unknown, receivedQuantity: unknown) {
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

function purchaseNextStatus(status: PurchaseKanbanStatus) {
  if (status === "requested") return "ordered";
  if (status === "ordered") return "partially_received";
  if (status === "partially_received") return "received";
  return "";
}

function purchaseProcessAction(status: PurchaseKanbanStatus) {
  if (status === "requested") return { label: "주문", stage: "order" };
  if (status === "ordered" || status === "partially_received") return { label: "입고", stage: "receive" };
  return null;
}

function formatCompactDateTime(value: unknown) {
  const rawValue = text(value);
  if (!rawValue) return "-";

  const date = new Date(rawValue);
  if (!Number.isFinite(date.getTime())) return rawValue;

  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getPurchaseEventAt(line: Row, order: Row | undefined, status: string) {
  if (status === "received" || status === "partially_received") {
    return (
      line.received_at ||
      line.receivedAt ||
      order?.received_at ||
      order?.receivedAt ||
      order?.updated_at ||
      order?.updatedAt ||
      line.updated_at ||
      line.updatedAt
    );
  }

  if (status === "ordered") {
    return (
      order?.ordered_at ||
      order?.orderedAt ||
      order?.order_date ||
      order?.orderDate ||
      order?.updated_at ||
      order?.updatedAt ||
      line.updated_at ||
      line.updatedAt
    );
  }

  return (
    order?.requested_at ||
    order?.requestedAt ||
    order?.created_at ||
    order?.createdAt ||
    line.created_at ||
    line.createdAt
  );
}

function getSaleEventAt(line: Row, sale: Row | undefined, status: string) {
  if (status === "issued") {
    return line.issued_at || line.issuedAt || sale?.issued_at || sale?.issuedAt || line.updated_at || line.updatedAt;
  }

  return sale?.charge_date || sale?.chargeDate || sale?.created_at || sale?.createdAt || line.created_at || line.createdAt;
}

function matchesSearchQuery(query: string, values: unknown[]) {
  const normalizedQuery = text(query).toLowerCase();
  if (!normalizedQuery) return true;
  return values.some((value) => text(value).toLowerCase().includes(normalizedQuery));
}

function processStatusPillClass(status: string) {
  if (status === "requested" || status === "charged") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "ordered") return "border-violet-200 bg-violet-50 text-violet-700";
  if (status === "partially_received" || status === "partial") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "received") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "issued") return "border-zinc-300 bg-zinc-100 text-zinc-700";
  return "border-border bg-muted text-muted-foreground";
}

function processStatusDotClass(status: string) {
  if (status === "requested" || status === "charged") return "bg-sky-500";
  if (status === "ordered") return "bg-violet-500";
  if (status === "partially_received" || status === "partial") return "bg-amber-500";
  if (status === "received") return "bg-emerald-500";
  if (status === "issued") return "bg-zinc-500";
  return "bg-muted-foreground";
}

function purchaseActionLabel(stage: string) {
  if (stage === "request") return "요청 저장";
  if (stage === "order") return "주문 저장";
  return "입고 반영";
}

function getPurchaseDialogTitle(stage: unknown, isEdit: boolean) {
  const normalizedStage = text(stage) || "request";
  const title = normalizedStage === "receive" ? "입고" : normalizedStage === "order" ? "주문" : "요청";
  return `${title} ${isEdit ? "수정" : "추가"}`;
}

function purchaseStageFromStatus(status: unknown) {
  const rawStatus = text(status);
  if (rawStatus === "requested") return "request";
  if (rawStatus === "ordered") return "order";
  return "receive";
}

function purchaseStatusToStage(status: PurchaseKanbanStatus) {
  if (status === "requested") return "request";
  if (status === "ordered") return "order";
  return "receive";
}

function getPurchaseFieldVisibility(stage: unknown) {
  const normalizedStage = text(stage) || "request";
  return {
    requester: normalizedStage === "request",
    location: normalizedStage === "request" || normalizedStage === "receive",
    requestedQuantity: normalizedStage === "request",
    orderedQuantity: normalizedStage === "order" || normalizedStage === "receive",
    receivedQuantity: normalizedStage === "receive",
    statementNumber: normalizedStage === "receive",
    classFit: normalizedStage === "request",
  };
}

function buildPurchaseCardDraft(line: Row, order: Row | undefined): PurchaseKanbanDraft {
  const requested = text(line.requested_quantity || line.requestedQuantity);
  const ordered = text(line.ordered_quantity || line.orderedQuantity);
  const received = text(line.received_quantity || line.receivedQuantity);

  return {
    textbookId: text(line.textbook_id || line.textbookId),
    requestedTextbookTitle: text(line.requested_textbook_title || line.requestedTextbookTitle || line.textbook_title || line.textbookTitle),
    classId: text(line.class_id || line.classId),
    supplierId: text(order?.supplier_id || order?.supplierId),
    locationId: text(line.location_id || line.locationId),
    requestBy: text(order?.requested_by || order?.requestedBy),
    requestedQuantity: requested || ordered || received || "1",
    orderedQuantity: ordered,
    receivedQuantity: received,
    unitCost: text(line.unit_cost || line.unitCost),
    statementNumber: text(order?.statement_number || order?.statementNumber),
    memo: text(line.memo || order?.memo),
  };
}

function getOrderablePurchaseRequestTextbook(line: Row, order: Row | undefined, textbooks: Row[]) {
  const draft = buildPurchaseCardDraft(line, order);
  return getTextbookById(textbooks, draft.textbookId || draft.requestedTextbookTitle);
}

function isOrderablePurchaseRequestLine(line: Row, order: Row | undefined, textbooks: Row[]) {
  return Boolean(getOrderablePurchaseRequestTextbook(line, order, textbooks));
}

function matchesPurchaseLineQuery({
  line,
  order,
  query,
  textbooks,
  classes,
  suppliers,
  publisherSupplierLinks,
  locations,
}: {
  line: Row;
  order: Row | undefined;
  query: string;
  textbooks: Row[];
  classes: Row[];
  suppliers: Row[];
  publisherSupplierLinks: Row[];
  locations: Row[];
}) {
  const draft = buildPurchaseCardDraft(line, order);
  const textbook = getTextbookById(textbooks, draft.textbookId || draft.requestedTextbookTitle);
  const configuredSupplierId = getConfiguredSupplierIdForTextbook(textbook, publisherSupplierLinks) || draft.supplierId;
  const classRecord = getClassById(classes, draft.classId);
  return matchesSearchQuery(query, [
    getPurchaseTextbookTitle(line, textbook),
    draft.requestedTextbookTitle,
    draft.requestBy,
    getClassName(classRecord || {}),
    getSupplierName(suppliers, configuredSupplierId),
    getLocationName(locations, draft.locationId),
    purchaseStatusLabel(line.status || order?.status, draft.orderedQuantity, draft.receivedQuantity),
    draft.statementNumber,
    draft.memo,
  ]);
}

function matchesSaleLineQuery({
  line,
  sale,
  query,
  textbooks,
  classes,
  locations,
}: {
  line: Row;
  sale: Row | undefined;
  query: string;
  textbooks: Row[];
  classes: Row[];
  locations: Row[];
}) {
  const textbook = getTextbookById(textbooks, text(line.textbook_id || line.textbookId));
  const classItem = getClassById(classes, text(line.class_id || sale?.class_id || sale?.classId));
  const status = text(line.status || sale?.status || "charged");
  return matchesSearchQuery(query, [
    textbook ? getTextbookTitle(textbook) : text(line.textbook_id || line.textbookId),
    getClassName(classItem || {}),
    text(line.student_name || line.student_id || line.studentId),
    getLocationName(locations, text(line.location_id || line.locationId || sale?.location_id || sale?.locationId)),
    saleStatusLabels[status] || status,
    text(line.charge_month || sale?.charge_month || sale?.chargeMonth),
  ]);
}

function buildPurchasePayloadFromDraft(
  line: Row,
  order: Row | undefined,
  draft: PurchaseKanbanDraft,
  targetStatus?: PurchaseKanbanStatus,
) {
  const status = targetStatus || (text(order?.status || line.status) as PurchaseKanbanStatus) || "requested";
  return {
    requestStage: purchaseStatusToStage(status),
    purchaseOrderId: getRecordId(order || {}) || text(line.purchase_order_id || line.purchaseOrderId),
    purchaseOrderLineId: getRecordId(line),
    textbookId: draft.textbookId,
    requestedTextbookTitle: draft.requestedTextbookTitle,
    classId: draft.classId,
    supplierId: draft.supplierId,
    locationId: draft.locationId,
    requestBy: draft.requestBy,
    requestedQuantity: draft.requestedQuantity,
    orderedQuantity: status === "requested" ? "" : draft.orderedQuantity || draft.requestedQuantity,
    receivedQuantity: status === "received" || status === "partially_received"
      ? draft.receivedQuantity || draft.orderedQuantity || draft.requestedQuantity
      : "",
    unitCost: draft.unitCost,
    statementNumber: draft.statementNumber,
    memo: draft.memo,
  };
}

function buildPurchaseStatusPayload(line: Row, order: Row | undefined, targetStatus: PurchaseKanbanStatus) {
  const draft = buildPurchaseCardDraft(line, order);
  const requestedQuantity = draft.requestedQuantity || draft.orderedQuantity || draft.receivedQuantity || "1";
  const orderedQuantity = draft.orderedQuantity || requestedQuantity;
  const receivedQuantity = targetStatus === "partially_received"
    ? draft.receivedQuantity || "1"
    : draft.receivedQuantity || orderedQuantity;

  return buildPurchasePayloadFromDraft(
    line,
    order,
    {
      ...draft,
      requestedQuantity,
      orderedQuantity,
      receivedQuantity,
    },
    targetStatus,
  );
}

function shouldShowPurchaseLineOnBoard(line: Row, scope: PurchaseBoardScope) {
  if (scope === "all") return true;
  if (text(line.status) !== "received") return true;
  if (scope === "active") return false;

  const order = (line.order || {}) as Row;
  const receivedAt = text(order.received_at || order.receivedAt || order.updated_at || order.updatedAt || order.created_at || order.createdAt);
  if (!receivedAt) return true;

  const receivedMs = new Date(receivedAt).getTime();
  if (!Number.isFinite(receivedMs)) return true;

  return Date.now() - receivedMs <= 1000 * 60 * 60 * 24 * 30;
}

function useTextbookOperationsData() {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<TextbookOperationsData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (authLoading) {
      return;
    }

    if (!user) {
      setData(emptyData);
      setError("관리자 세션을 확인할 수 없습니다. 다시 로그인해 주세요.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const next = await textbookService.listTextbookOperationsData();
      setData(next as TextbookOperationsData);
    } catch (loadError) {
      setData(emptyData);
      setError(loadError instanceof Error ? loadError.message : "교재 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [authLoading, user]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, refresh: load, user };
}

function TextbookOpsCommandCenter({
  metrics,
  activeQueueKey,
  onSelectQueue,
}: {
  metrics: ReturnType<typeof buildTextbookOpsMetrics>;
  activeQueueKey: TextbookOpsQueueKey | "";
  onSelectQueue: (key: TextbookOpsQueueKey) => void;
}) {
  const actionItems = [
    { key: "unregistered", label: "미등록 요청", value: metrics.unregisteredRequestCount, tone: "text-amber-700" },
    { key: "order", label: "주문 필요", value: metrics.orderNeededCount, tone: "text-blue-700" },
    { key: "partial", label: "부분입고", value: metrics.partialReceiptCount, tone: "text-orange-700" },
    { key: "issue", label: "출고 대기", value: metrics.issueWaitingCount, tone: "text-emerald-700" },
    { key: "stockRisk", label: "재고 부족", value: metrics.stockRiskCount, tone: "text-red-700" },
  ] satisfies Array<{ key: TextbookOpsQueueKey; label: string; value: number; tone: string }>;
  const activeQueueTotal = actionItems.reduce((sum, item) => sum + item.value, 0);

  if (activeQueueTotal <= 0) {
    return null;
  }

  return (
    <section aria-label="교재 운영 액션 큐" className="mt-3 flex min-w-0 flex-wrap items-center gap-2 rounded-lg border bg-background p-2">
      <Badge variant={activeQueueTotal > 0 ? "default" : "secondary"} className="h-8 rounded-md px-3">
        대기 {formatQuantity(activeQueueTotal)}
      </Badge>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {actionItems.map((item) => (
          <Button
            key={item.key}
            type="button"
            variant={activeQueueKey === item.key ? "default" : "outline"}
            size="sm"
            className="h-8 min-w-[7.5rem] justify-between rounded-md px-3"
            aria-label={`${item.label} 보기`}
            onClick={() => onSelectQueue(item.key)}
          >
            <span className="truncate">{item.label}</span>
            <span className={cn("font-semibold", activeQueueKey === item.key ? "text-primary-foreground" : item.tone)}>
              {formatQuantity(item.value)}
            </span>
          </Button>
        ))}
      </div>
    </section>
  );
}

export function TextbookOperationsWorkspace() {
  const { data, loading, error, refresh, user } = useTextbookOperationsData();
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [operationQuery, setOperationQuery] = useState("");
  const [activeTab, setActiveTab] = useState("master");
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>("all");
  const [textbookQualityFilter, setTextbookQualityFilter] = useState<TextbookQualityFilter>("all");
  const [subjectGroupFilter, setSubjectGroupFilter] = useState("all");
  const [schoolLevelGroupFilter, setSchoolLevelGroupFilter] = useState("all");
  const [gradeLevelGroupFilter, setGradeLevelGroupFilter] = useState("all");
  const [categoryGroupFilter, setCategoryGroupFilter] = useState("all");
  const [collapsedTextbookGroups, setCollapsedTextbookGroups] = useState<string[]>([]);
  const [selectedTextbookIds, setSelectedTextbookIds] = useState<string[]>([]);
  const [bulkTextbookPatch, setBulkTextbookPatch] = useState(emptyBulkTextbookPatch);
  const [masterForm, setMasterForm] = useState(emptyMasterForm);
  const [masterDialogOpen, setMasterDialogOpen] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState(emptyPurchaseForm);
  const [purchaseDialogOpen, setPurchaseDialogOpen] = useState(false);
  const [selectedPurchaseLineId, setSelectedPurchaseLineId] = useState("");
  const [selectedPurchaseLineIds, setSelectedPurchaseLineIds] = useState<string[]>([]);
  const [bulkOrderDialogOpen, setBulkOrderDialogOpen] = useState(false);
  const [bulkOrderQuantities, setBulkOrderQuantities] = useState<Record<string, string>>({});
  const [purchaseBoardScope, setPurchaseBoardScope] = useState<PurchaseBoardScope>("active");
  const [purchaseRequestFilter, setPurchaseRequestFilter] = useState<PurchaseRequestFilter>("all");
  const [purchaseOrderFilter, setPurchaseOrderFilter] = useState<PurchaseOrderFilter>("all");
  const [inventoryAuditFilter, setInventoryAuditFilter] = useState<InventoryAuditFilter>("recommended");
  const [inventoryCountLocationId, setInventoryCountLocationId] = useState("");
  const [inventoryCountDrafts, setInventoryCountDrafts] = useState<Record<string, string>>({});
  const [inventoryCountMemoDrafts, setInventoryCountMemoDrafts] = useState<Record<string, string>>({});
  const [saleForm, setSaleForm] = useState({
    classId: "",
    textbookId: "",
    chargeMonth: currentMonth(),
    locationId: "",
    memo: "",
  });
  const [salesProcessFilter, setSalesProcessFilter] = useState<SalesProcessFilter>("all");
  const [saleDialogOpen, setSaleDialogOpen] = useState(false);
  const [closingDialogOpen, setClosingDialogOpen] = useState(false);
  const [excludedStudentIds, setExcludedStudentIds] = useState<string[]>([]);
  const [closingForm, setClosingForm] = useState({
    closingMonth: currentMonth(),
    subject: "all",
    openingQuantity: "0",
    openingAmount: "0",
    memo: "",
  });

  const locations = useMemo(
    () => data.locations.length > 0
      ? data.locations
      : [
          { id: "main", code: "main", name: "본관" },
          { id: "annex", code: "annex", name: "별관" },
        ],
    [data.locations],
  );
  const selectedLocationId = purchaseForm.locationId || data.defaultLocationId || text(locations[0]?.id);
  const saleLocationId = saleForm.locationId || data.defaultLocationId || text(locations[0]?.id);
  const selectedInventoryCountLocationId = inventoryCountLocationId || data.defaultLocationId || text(locations[0]?.id);
  const schemaDisabled = !data.isSchemaReady;
  const schemaMessage = schemaDisabled
    ? `교재 관리 DB 마이그레이션이 아직 적용되지 않았습니다. 누락: ${data.missingTables.join(", ")}`
    : "";
  const currentUserId = text(user?.id);
  const currentUserLabel = text(user?.email || user?.id);
  const publisherGroupOptions = useMemo(
    () => [...new Set(data.inventory.map(getPublisherLabel))]
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, "ko")),
    [data.inventory],
  );
  const textbookSubSubjectSettings = useMemo<TextbookSubSubjectSettingRecord[]>(
    () => mergeTextbookSubSubjectSettings(data.textbookSubSubjectSettings),
    [data.textbookSubSubjectSettings],
  );
  const gradeLevelGroupOptions = useMemo(
    () => getGradeOptionsForSchoolLevel(schoolLevelGroupFilter === "all" ? "" : schoolLevelGroupFilter),
    [schoolLevelGroupFilter],
  );
  const categoryGroupOptions = useMemo(
    () => [
      ...new Set([
        ...getSubSubjectOptionsForSubject(textbookSubSubjectSettings, subjectGroupFilter),
        ...data.inventory
          .filter((row) => subjectGroupFilter === "all" || normalizeSubjectValue(row.subject) === subjectGroupFilter)
          .map(getTextbookSubSubject),
      ]),
    ]
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, "ko")),
    [data.inventory, subjectGroupFilter, textbookSubSubjectSettings],
  );
  const duplicateTextbookTitleKeys = useMemo(() => {
    const titleCounts = new Map<string, number>();
    for (const row of data.inventory) {
      const key = getTextbookTitleKey(row);
      if (!key) continue;
      titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
    }
    return new Set([...titleCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  }, [data.inventory]);
  const activeTextbookQualityFilter = activeTab === "master" ? textbookQualityFilter : "all";
  const listFilteredInventory = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const normalizedBarcodeQuery = normalizeBarcodeValue(keyword);

    return data.inventory.filter((row) => {
      if (subjectGroupFilter !== "all" && normalizeSubjectValue(row.subject) !== subjectGroupFilter) return false;
      if (schoolLevelGroupFilter !== "all" && getTextbookSchoolLevel(row) !== schoolLevelGroupFilter) return false;
      if (gradeLevelGroupFilter !== "all" && getTextbookGradeLevel(row) !== gradeLevelGroupFilter) return false;
      if (categoryGroupFilter !== "all" && getTextbookSubSubject(row) !== categoryGroupFilter) return false;
      if (!keyword) {
        return true;
      }
      const haystack = [
        getTextbookTitle(row),
        row.subject,
        getSubjectLabel(row.subject),
        getTaxonomyCategoryLabel(row),
        getTextbookSchoolLevelLabel(getTextbookSchoolLevel(row)),
        getTextbookGradeLabel(getTextbookGradeLevel(row)),
        getTextbookSubSubject(row),
        row.category,
        row.publisher,
        row.isbn13,
        row.barcode,
      ]
        .map(text)
        .join(" ")
        .toLowerCase();
      const barcodeText = normalizeBarcodeValue(`${text(row.isbn13)} ${text(row.barcode)}`);
      return haystack.includes(keyword) || (normalizedBarcodeQuery && barcodeText.includes(normalizedBarcodeQuery));
    }).filter((row) => matchesTextbookQualityFilter(row, activeTextbookQualityFilter, duplicateTextbookTitleKeys));
  }, [activeTextbookQualityFilter, categoryGroupFilter, data.inventory, duplicateTextbookTitleKeys, gradeLevelGroupFilter, query, schoolLevelGroupFilter, subjectGroupFilter]);
  const textbookQualityFilterCounts = useMemo(
    () => Object.fromEntries(
      (Object.keys(textbookQualityFilterLabels) as TextbookQualityFilter[]).map((filter) => [
        filter,
        data.inventory
          .filter((row) => {
            if (subjectGroupFilter !== "all" && normalizeSubjectValue(row.subject) !== subjectGroupFilter) return false;
            if (schoolLevelGroupFilter !== "all" && getTextbookSchoolLevel(row) !== schoolLevelGroupFilter) return false;
            if (gradeLevelGroupFilter !== "all" && getTextbookGradeLevel(row) !== gradeLevelGroupFilter) return false;
            if (categoryGroupFilter !== "all" && getTextbookSubSubject(row) !== categoryGroupFilter) return false;
            return matchesTextbookQualityFilter(row, filter, duplicateTextbookTitleKeys);
          })
          .length,
      ]),
    ) as Record<TextbookQualityFilter, number>,
    [categoryGroupFilter, data.inventory, duplicateTextbookTitleKeys, gradeLevelGroupFilter, schoolLevelGroupFilter, subjectGroupFilter],
  );
  const inventoryFilterCounts = useMemo(
    () => Object.fromEntries(
      (Object.keys(inventoryFilterLabels) as InventoryFilter[]).map((filter) => [
        filter,
        listFilteredInventory.filter((row) => matchesInventoryFilter(row, filter)).length,
      ]),
    ) as Record<InventoryFilter, number>,
    [listFilteredInventory],
  );
  const filteredInventory = useMemo(
    () => listFilteredInventory.filter((row) => matchesInventoryFilter(row, inventoryFilter)),
    [inventoryFilter, listFilteredInventory],
  );
  const filteredInventoryTotalQuantity = filteredInventory.reduce((sum, row) => sum + numberValue(row.totalQuantity), 0);
  const filteredInventorySaleValue = filteredInventory.reduce((sum, row) => sum + getTextbookSalePrice(row), 0);
  const visibleTextbookIds = useMemo(
    () => filteredInventory.map(getRecordId).filter(Boolean),
    [filteredInventory],
  );
  const visibleTextbookGroupLabels = useMemo(
    () => [...new Set(filteredInventory.map(getTextbookGroupLabel))]
      .sort(compareTextbookGroupLabels),
    [filteredInventory],
  );
  const selectedTextbookRows = useMemo(
    () => filteredInventory.filter((row) => selectedTextbookIds.includes(getRecordId(row))),
    [filteredInventory, selectedTextbookIds],
  );
  const selectedVisibleTextbookCount = visibleTextbookIds.filter((id) => selectedTextbookIds.includes(id)).length;
  const allVisibleTextbooksSelected = visibleTextbookIds.length > 0 && selectedVisibleTextbookCount === visibleTextbookIds.length;
  const someVisibleTextbooksSelected = selectedVisibleTextbookCount > 0 && !allVisibleTextbooksSelected;
  const hasTextbookListFilter =
    Boolean(query) ||
    inventoryFilter !== "all" ||
    activeTextbookQualityFilter !== "all" ||
    subjectGroupFilter !== "all" ||
    schoolLevelGroupFilter !== "all" ||
    gradeLevelGroupFilter !== "all" ||
    categoryGroupFilter !== "all";
  const textbookEmptyLabel = hasTextbookListFilter ? "조건에 맞는 교재가 없습니다" : "교재가 없습니다";
  const masterDuplicateRows = useMemo(() => {
    const currentTitle = text(masterForm.title).trim().toLowerCase();
    if (!currentTitle) return [];

    const currentPublisher = text(masterForm.publisher).trim().toLowerCase();
    const currentCategory = (
      [
        getTextbookSchoolLevelLabel(masterForm.schoolLevel),
        getTextbookGradeLabel(masterForm.gradeLevel),
        text(masterForm.subSubject),
      ].filter(Boolean).join(" ") || text(masterForm.category)
    ).trim().toLowerCase();

    return data.inventory.filter((row) => {
      if (getRecordId(row) === masterForm.id) return false;
      if (getTextbookTitle(row).trim().toLowerCase() !== currentTitle) return false;
      if (normalizeSubjectValue(row.subject) !== masterForm.subject) return false;
      if (currentPublisher && getPublisherLabel(row).trim().toLowerCase() !== currentPublisher) return false;
      if (currentCategory && getCategoryLabel(row).trim().toLowerCase() !== currentCategory) return false;
      return true;
    });
  }, [
    data.inventory,
    masterForm.category,
    masterForm.gradeLevel,
    masterForm.id,
    masterForm.publisher,
    masterForm.schoolLevel,
    masterForm.subSubject,
    masterForm.subject,
    masterForm.title,
  ]);

  useEffect(() => {
    const existingIds = new Set(data.inventory.map(getRecordId).filter(Boolean));
    setSelectedTextbookIds((current) => current.filter((id) => existingIds.has(id)));
  }, [data.inventory]);

  useEffect(() => {
    const visibleIds = new Set(visibleTextbookIds);
    setSelectedTextbookIds((current) => current.filter((id) => visibleIds.has(id)));
  }, [visibleTextbookIds]);

  useEffect(() => {
    const existingIds = new Set(data.purchaseOrderLines.map(getRecordId).filter(Boolean));
    setSelectedPurchaseLineIds((current) => current.filter((id) => existingIds.has(id)));
  }, [data.purchaseOrderLines]);

  useEffect(() => {
    const validDraftKeys = new Set(
      data.inventory.flatMap((row) => {
        const rowId = getRecordId(row);
        return locations.map((location) => getInventoryCountDraftKey(rowId, getRecordId(location)));
      }),
    );
    setInventoryCountDrafts((current) => {
      const nextEntries = Object.entries(current).filter(([key]) => validDraftKeys.has(key));
      return nextEntries.length === Object.keys(current).length ? current : Object.fromEntries(nextEntries);
    });
    setInventoryCountMemoDrafts((current) => {
      const nextEntries = Object.entries(current).filter(([key]) => validDraftKeys.has(key));
      return nextEntries.length === Object.keys(current).length ? current : Object.fromEntries(nextEntries);
    });
  }, [data.inventory, locations]);

  useEffect(() => {
    if (gradeLevelGroupFilter === "all") return;
    if (gradeLevelGroupOptions.some((option) => option.value === gradeLevelGroupFilter)) return;
    setGradeLevelGroupFilter("all");
  }, [gradeLevelGroupFilter, gradeLevelGroupOptions]);

  useEffect(() => {
    if (categoryGroupFilter === "all") return;
    if (categoryGroupOptions.includes(categoryGroupFilter)) return;
    setCategoryGroupFilter("all");
  }, [categoryGroupFilter, categoryGroupOptions]);

  const activeTextbooks = data.textbooks.filter(isActiveTextbook);
  const purchaseOrdersById = useMemo(
    () => new Map(data.purchaseOrders.map((order) => [getRecordId(order), order])),
    [data.purchaseOrders],
  );
  const selectedPurchaseLine = data.purchaseOrderLines.find((line) => getRecordId(line) === selectedPurchaseLineId);
  const selectedBulkOrderLines = useMemo(
    () => selectedPurchaseLineIds
      .map((id) => data.purchaseOrderLines.find((line) => getRecordId(line) === id))
      .filter((line): line is Row => {
        if (!line) return false;
        const order = getPurchaseLineOrder(line, purchaseOrdersById);
        return isOrderablePurchaseRequestLine(line, order, data.textbooks);
      }),
    [data.purchaseOrderLines, data.textbooks, purchaseOrdersById, selectedPurchaseLineIds],
  );
  const selectedPurchaseOrder = selectedPurchaseLine
    ? getPurchaseLineOrder(selectedPurchaseLine, purchaseOrdersById)
    : undefined;
  const purchaseFieldVisibility = getPurchaseFieldVisibility(purchaseForm.requestStage);
  const explicitlySelectedPurchaseTextbook = getTextbookById(data.textbooks, purchaseForm.textbookId);
  const selectedPurchaseTextbook = explicitlySelectedPurchaseTextbook || getTextbookById(data.textbooks, purchaseForm.requestedTextbookTitle);
  const explicitPurchaseTextbookId = getRecordId(explicitlySelectedPurchaseTextbook || {});
  const selectedPurchaseTextbookId = getRecordId(selectedPurchaseTextbook || {});
  const purchaseRequestTitle = text(purchaseForm.requestedTextbookTitle || getTextbookTitle(selectedPurchaseTextbook || {}) || purchaseForm.textbookId);
  const configuredPurchaseSupplierId =
    getConfiguredSupplierIdForTextbook(selectedPurchaseTextbook, data.publisherSupplierLinks) || purchaseForm.supplierId;
  const configuredPurchaseUnitCost = getTextbookSalePrice(selectedPurchaseTextbook || {}) || numberValue(purchaseForm.unitCost);
  const configuredPurchaseSupplierLabel = configuredPurchaseSupplierId
    ? getSupplierName(data.suppliers, configuredPurchaseSupplierId)
    : "-";
  const selectedPurchaseClass = getClassById(data.classes, purchaseForm.classId);
  const purchaseClassStudentCount = getClassStudentCount(selectedPurchaseClass, data.students);
  const purchaseQuantityFit = getPurchaseQuantityClassFit(purchaseForm.requestedQuantity, purchaseClassStudentCount);
  const selectedClassId = saleForm.classId;
  const selectedSaleClass = getClassById(data.classes, selectedClassId);
  const selectedSaleTextbook = getTextbookById(data.textbooks, saleForm.textbookId);
  const selectedSaleInventory = data.inventory.find((row) => getRecordId(row) === saleForm.textbookId);
  const saleAvailableQuantity = getInventoryQuantity(selectedSaleInventory, saleLocationId);
  const selectedClassStudents = getStudentsByClass(selectedSaleClass, data.students);
  const saleDraft = selectedSaleClass && selectedSaleTextbook
    ? buildTextbookSaleDraft({
        classRecord: selectedSaleClass,
        students: selectedClassStudents,
        textbook: selectedSaleTextbook,
        chargeMonth: saleForm.chargeMonth,
        excludedStudentIds,
        locationId: saleLocationId,
        availableQuantity: saleAvailableQuantity,
      })
    : { lines: [], totalAmount: 0, totalQuantity: 0, availableQuantity: saleAvailableQuantity, stockShortage: 0, hasStockShortage: false };
  const saleSubmitDisabled = !selectedSaleClass ||
    !selectedSaleTextbook ||
    saleDraft.lines.length === 0;
  const operationMetrics = useMemo(() => buildTextbookOpsMetrics(data), [data]);
  const showsInventoryTools = activeTab === "master" || activeTab === "inventory";
  const hasPurchaseProcessRows = data.purchaseOrderLines.length > 0;
  const hasSalesProcessRows = data.saleLines.length > 0;
  const showsProcessSearch =
    (activeTab === "requests" || activeTab === "purchase")
      ? hasPurchaseProcessRows
      : activeTab === "sales" && hasSalesProcessRows;
  const activeQueueKey: TextbookOpsQueueKey | "" =
    activeTab === "requests" && purchaseRequestFilter === "unregistered" ? "unregistered" :
    activeTab === "requests" && purchaseRequestFilter === "orderable" ? "order" :
    activeTab === "purchase" && purchaseOrderFilter === "partial" ? "partial" :
    activeTab === "sales" && salesProcessFilter === "waiting" ? "issue" :
    activeTab === "inventory" && inventoryFilter === "shortage" ? "stockRisk" :
    "";
  const masterGradeOptions = getGradeOptionsForSchoolLevel(masterForm.schoolLevel);
  const masterSubSubjectOptions = getSubSubjectOptionsForSubject(textbookSubSubjectSettings, masterForm.subject);
  const masterSubmitDisabled = saving === "master" || !text(masterForm.title);
  const purchaseSubmitDisabled = schemaDisabled ||
    saving === "purchase" ||
    (purchaseForm.requestStage === "request" && !purchaseRequestTitle) ||
    (purchaseForm.requestStage !== "request" && !selectedPurchaseTextbookId) ||
    !numberValue(purchaseForm.requestedQuantity) ||
    (purchaseForm.requestStage !== "request" && !numberValue(purchaseForm.orderedQuantity)) ||
    (purchaseForm.requestStage === "receive" && !numberValue(purchaseForm.receivedQuantity));
  const filteredClosingMoves = filterStockMovesForClosing({
    closingMonth: closingForm.closingMonth,
    subject: closingForm.subject,
    textbooks: data.textbooks,
    stockMoves: data.stockMoves,
  });
  const closingPreview = buildTextbookMonthlyClosing({
    openingQuantity: numberValue(closingForm.openingQuantity),
    openingAmount: numberValue(closingForm.openingAmount),
    stockMoves: filteredClosingMoves,
  });
  const closingNeedsMemo = closingPreview.needsReview && !text(closingForm.memo);

  function setPurchaseField(name: string, value: string) {
    setPurchaseForm((current) => {
      if (name === "textbookId") {
        const textbook = getTextbookById(data.textbooks, value);
        return {
          ...current,
          textbookId: value,
          requestedTextbookTitle: current.requestStage === "request" && textbook
            ? getTextbookTitle(textbook)
            : current.requestedTextbookTitle,
        };
      }

      if (name === "classId") {
        const previousClass = getClassById(data.classes, current.classId);
        const nextClass = getClassById(data.classes, value);
        const previousTeacher = getDefaultTeacherForClass(previousClass, data.teacherCatalogs);
        const nextTeacher = getDefaultTeacherForClass(nextClass, data.teacherCatalogs);
        const shouldDefaultTeacher = !text(current.requestBy) || text(current.requestBy) === previousTeacher;
        const nextLocationId = inferClassLocationId(nextClass, locations);

        return {
          ...current,
          classId: value,
          requestBy: shouldDefaultTeacher ? nextTeacher : current.requestBy,
          locationId: nextLocationId || current.locationId,
        };
      }

      if (name !== "requestStage") {
        return { ...current, [name]: value };
      }

      return {
        ...current,
        requestStage: value,
        orderedQuantity: value === "request" ? "" : current.orderedQuantity || current.requestedQuantity,
        receivedQuantity: value === "receive" ? current.receivedQuantity || current.orderedQuantity || current.requestedQuantity : "",
      };
    });
  }

  function setSaleField(name: string, value: string) {
    setSaleForm((current) => ({ ...current, [name]: value }));
  }

  function openNewMasterDialog() {
    setMasterForm(emptyMasterForm);
    setMessage("");
    setMasterDialogOpen(true);
  }

  function selectMasterTextbook(row: Row) {
    setMasterForm({
      id: getRecordId(row),
      title: getTextbookTitle(row),
      subject: normalizeSubjectValue(row.subject),
      schoolLevel: getTextbookSchoolLevel(row),
      gradeLevel: getTextbookGradeLevel(row),
      subSubject: getTextbookSubSubject(row),
      category: text(row.category),
      publisher: text(row.publisher),
      isbn13: normalizeBarcodeValue(row.isbn13),
      barcode: normalizeBarcodeValue(row.barcode),
      price: text(row.sale_price || row.salePrice || row.price || ""),
      status: normalizeStatusValue(row.status),
    });
    setMasterDialogOpen(true);
    setMessage("");
  }

  function openMasterFromPurchaseRequest(line: Row) {
    const title = getPurchaseTextbookTitle(line, getTextbookById(data.textbooks, text(line.textbook_id || line.textbookId) || getRequestedTextbookTitle(line)));
    setMasterForm({
      ...emptyMasterForm,
      title: title === "-" ? "" : title,
      subject: normalizeSubjectValue(line.subject || emptyMasterForm.subject),
      schoolLevel: getTextbookSchoolLevel(line),
      gradeLevel: getTextbookGradeLevel(line),
      subSubject: getTextbookSubSubject(line),
    });
    setMasterDialogOpen(true);
    setMessage("");
  }

  function resetPurchaseForm() {
    setSelectedPurchaseLineId("");
    setPurchaseForm(emptyPurchaseForm);
    setMessage("");
  }

  function openNewPurchaseDialog() {
    setSelectedPurchaseLineId("");
    setPurchaseForm({ ...emptyPurchaseForm, requestStage: "order" });
    setMessage("");
    setPurchaseDialogOpen(true);
  }

  function openNewRequestDialog() {
    setSelectedPurchaseLineId("");
    setPurchaseForm({ ...emptyPurchaseForm, requestStage: "request" });
    setMessage("");
    setPurchaseDialogOpen(true);
  }

  function openNewSaleDialog() {
    setSaleForm({
      classId: "",
      textbookId: "",
      chargeMonth: currentMonth(),
      locationId: "",
      memo: "",
    });
    setExcludedStudentIds([]);
    setMessage("");
    setSaleDialogOpen(true);
  }

  function openClosingDialog() {
    setClosingForm({
      closingMonth: currentMonth(),
      subject: "all",
      openingQuantity: "0",
      openingAmount: "0",
      memo: "",
    });
    setMessage("");
    setClosingDialogOpen(true);
  }

  function closeMasterDialog() {
    setMasterDialogOpen(false);
    setMessage("");
  }

  function closePurchaseDialog() {
    setPurchaseDialogOpen(false);
    resetPurchaseForm();
  }

  function closeSaleDialog() {
    setSaleDialogOpen(false);
    setMessage("");
  }

  function closeClosingDialog() {
    setClosingDialogOpen(false);
    setMessage("");
  }

  function changeActiveTab(value: string) {
    setActiveTab(value);
    setMessage("");
    if (value !== "requests" && value !== "purchase" && value !== "sales") {
      setOperationQuery("");
    }
    if (value !== "requests") {
      setPurchaseRequestFilter("all");
    }
    if (value !== "purchase") {
      setPurchaseOrderFilter("all");
    }
    if (value !== "sales") {
      setSalesProcessFilter("all");
    }
  }

  function resetTextbookListFilters() {
    setQuery("");
    setInventoryFilter("all");
    setTextbookQualityFilter("all");
    setSubjectGroupFilter("all");
    setSchoolLevelGroupFilter("all");
    setGradeLevelGroupFilter("all");
    setCategoryGroupFilter("all");
    setCollapsedTextbookGroups([]);
  }

  function collapseVisibleTextbookGroups() {
    setCollapsedTextbookGroups(visibleTextbookGroupLabels);
  }

  function expandVisibleTextbookGroups() {
    setCollapsedTextbookGroups([]);
  }

  function openInventoryShortageQueue() {
    changeActiveTab("inventory");
    setInventoryFilter("shortage");
  }

  function openTextbookOpsQueue(key: TextbookOpsQueueKey) {
    setMessage("");
    setOperationQuery("");
    if (key !== "stockRisk") {
      setInventoryFilter("all");
    }
    if (key === "unregistered") {
      setActiveTab("requests");
      setPurchaseRequestFilter("unregistered");
      setPurchaseOrderFilter("all");
      setSalesProcessFilter("all");
      return;
    }
    if (key === "order") {
      setActiveTab("requests");
      setPurchaseRequestFilter("orderable");
      setPurchaseOrderFilter("all");
      setSalesProcessFilter("all");
      return;
    }
    if (key === "partial") {
      setActiveTab("purchase");
      setPurchaseRequestFilter("all");
      setPurchaseOrderFilter("partial");
      setSalesProcessFilter("all");
      setPurchaseBoardScope("active");
      return;
    }
    if (key === "issue") {
      setActiveTab("sales");
      setPurchaseRequestFilter("all");
      setPurchaseOrderFilter("all");
      setSalesProcessFilter("waiting");
      return;
    }
    setPurchaseOrderFilter("all");
    openInventoryShortageQueue();
  }

  function toggleTextbookGroup(label: string) {
    setCollapsedTextbookGroups((current) =>
      current.includes(label) ? current.filter((item) => item !== label) : [...current, label],
    );
  }

  function toggleTextbookSelection(id: string, checked: boolean) {
    setSelectedTextbookIds((current) => {
      if (!id) return current;
      if (checked) {
        return current.includes(id) ? current : [...current, id];
      }
      return current.filter((item) => item !== id);
    });
  }

  function toggleAllVisibleTextbooks(checked: boolean) {
    setSelectedTextbookIds((current) => {
      if (!checked) {
        return current.filter((id) => !visibleTextbookIds.includes(id));
      }
      return [...new Set([...current, ...visibleTextbookIds])];
    });
  }

  function togglePurchaseLineSelection(id: string, checked: boolean) {
    setSelectedPurchaseLineIds((current) => {
      if (!id) return current;
      if (checked) {
        return current.includes(id) ? current : [...current, id];
      }
      return current.filter((item) => item !== id);
    });
  }

  function toggleVisiblePurchaseLineSelection(ids: string[], checked: boolean) {
    setSelectedPurchaseLineIds((current) => {
      if (!checked) {
        return current.filter((id) => !ids.includes(id));
      }
      return [...new Set([...current, ...ids])];
    });
  }

  function openBulkOrderDialog() {
    if (selectedBulkOrderLines.length === 0) {
      return;
    }

    setBulkOrderQuantities(Object.fromEntries(selectedBulkOrderLines.map((line) => {
      const order = getPurchaseLineOrder(line, purchaseOrdersById);
      const draft = buildPurchaseCardDraft(line, order);
      return [getRecordId(line), draft.orderedQuantity || draft.requestedQuantity || "1"];
    })));
    setBulkOrderDialogOpen(true);
    setMessage("");
  }

  function closeBulkOrderDialog() {
    setBulkOrderDialogOpen(false);
    setBulkOrderQuantities({});
    setMessage("");
  }

  function setBulkOrderQuantity(lineId: string, value: string) {
    setBulkOrderQuantities((current) => ({ ...current, [lineId]: value }));
  }

  function submitBulkOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedBulkOrderLines.length === 0) {
      return;
    }

    void runAction(
      "purchase-bulk-order",
      async () => {
        await Promise.all(selectedBulkOrderLines.map((line) => {
          const order = getPurchaseLineOrder(line, purchaseOrdersById);
          const draft = buildPurchaseCardDraft(line, order);
          const lineId = getRecordId(line);
          return textbookService.updatePurchaseLifecycle({
            ...buildPurchasePayloadFromDraft(
              line,
              order,
              {
                ...draft,
                orderedQuantity: text(bulkOrderQuantities[lineId]) || draft.requestedQuantity || "1",
              },
              "ordered",
            ),
            createdBy: currentUserId,
          });
        }));
        setSelectedPurchaseLineIds([]);
        setBulkOrderQuantities({});
      },
      `${formatQuantity(selectedBulkOrderLines.length)}건을 주문으로 전환했습니다.`,
    ).then((ok) => {
      if (ok) {
        setBulkOrderDialogOpen(false);
      }
    });
  }

  function setBulkTextbookPatchField(name: keyof typeof emptyBulkTextbookPatch, value: string) {
    setBulkTextbookPatch((current) => ({ ...current, [name]: value }));
  }

  function getBulkTextbookPatchValues() {
    const patch: Row = {};
    if (bulkTextbookPatch.subject !== "keep") patch.subject = bulkTextbookPatch.subject;
    if (text(bulkTextbookPatch.category)) patch.category = text(bulkTextbookPatch.category);
    if (text(bulkTextbookPatch.publisher)) patch.publisher = text(bulkTextbookPatch.publisher);
    if (text(bulkTextbookPatch.price)) patch.price = text(bulkTextbookPatch.price);
    if (bulkTextbookPatch.status !== "keep") patch.status = bulkTextbookPatch.status;
    return patch;
  }

  function applyBulkTextbookEdit() {
    const patch = getBulkTextbookPatchValues();
    if (selectedTextbookRows.length === 0 || Object.keys(patch).length === 0) {
      return;
    }

    void runAction(
      "textbook-bulk-edit",
      async () => {
        await Promise.all(
          selectedTextbookRows.map((row) =>
            textbookService.upsertTextbookMaster({
              ...row,
              id: getRecordId(row),
              title: getTextbookTitle(row),
              price: text(row.sale_price || row.salePrice || row.price),
              status: normalizeStatusValue(row.status),
              ...patch,
            }),
          ),
        );
        setSelectedTextbookIds([]);
        setBulkTextbookPatch(emptyBulkTextbookPatch);
      },
      `${formatQuantity(selectedTextbookRows.length)}개 교재를 수정했습니다.`,
    );
  }

  function applyBulkTextbookStatus(status: string) {
    if (selectedTextbookRows.length === 0) {
      return;
    }

    const statusLabel = statusOptions.find((option) => option.value === status)?.label || status;
    void runAction(
      "textbook-bulk-status",
      async () => {
        await Promise.all(
          selectedTextbookRows.map((row) =>
            textbookService.upsertTextbookMaster({
              ...row,
              id: getRecordId(row),
              title: getTextbookTitle(row),
              price: text(row.sale_price || row.salePrice || row.price),
              status,
            }),
          ),
        );
        setSelectedTextbookIds([]);
        setBulkTextbookPatch(emptyBulkTextbookPatch);
      },
      `${formatQuantity(selectedTextbookRows.length)}개 교재를 ${statusLabel}으로 변경했습니다.`,
    );
  }

  function deleteSelectedTextbooks() {
    if (selectedTextbookRows.length === 0) {
      return;
    }

    const confirmed =
      typeof window === "undefined" ||
      window.confirm(`${formatQuantity(selectedTextbookRows.length)}개 교재를 삭제할까요? 재고/주문/출고 이력이 연결된 교재는 DB에서 거부될 수 있습니다.`);
    if (!confirmed) {
      return;
    }

    void runAction(
      "textbook-bulk-delete",
      async () => {
        await textbookService.deleteTextbookMasters(selectedTextbookIds);
        setSelectedTextbookIds([]);
      },
      `${formatQuantity(selectedTextbookRows.length)}개 교재를 삭제했습니다.`,
    );
  }

  function selectPurchaseLine(line: Row, order: Row | undefined, stageOverride?: string) {
    const status = text(order?.status || line.status);
    const orderedQuantity = text(line.ordered_quantity || line.orderedQuantity);
    const requestedQuantity = text(line.requested_quantity || line.requestedQuantity);
    const nextStage = stageOverride || purchaseStageFromStatus(status);
    const nextOrderedQuantity = nextStage === "request" ? orderedQuantity : orderedQuantity || requestedQuantity || "1";
    const requestedTitle = getRequestedTextbookTitle(line);
    const textbook = getTextbookById(data.textbooks, text(line.textbook_id || line.textbookId) || requestedTitle);
    setSelectedPurchaseLineId(getRecordId(line));
    setPurchaseForm({
      requestStage: nextStage,
      textbookId: getRecordId(textbook || {}) || text(line.textbook_id || line.textbookId),
      requestedTextbookTitle: requestedTitle || getTextbookTitle(textbook || {}) || text(line.textbook_id || line.textbookId),
      classId: text(line.class_id || line.classId),
      supplierId: text(order?.supplier_id || order?.supplierId),
      locationId: text(line.location_id || line.locationId),
      requestBy: text(order?.requested_by || order?.requestedBy),
      requestedQuantity: requestedQuantity || orderedQuantity || "1",
      orderedQuantity: nextOrderedQuantity,
      receivedQuantity: nextStage === "receive"
        ? text(line.received_quantity || line.receivedQuantity) || nextOrderedQuantity || requestedQuantity || "1"
        : text(line.received_quantity || line.receivedQuantity),
      unitCost: text(line.unit_cost || line.unitCost),
      statementNumber: text(order?.statement_number || order?.statementNumber),
      memo: text(line.memo || order?.memo),
    });
    setPurchaseDialogOpen(true);
    setMessage("");
  }

  async function runAction(name: string, action: () => Promise<unknown>, success: string) {
    setSaving(name);
    setMessage("");
    try {
      await action();
      setMessage(success);
      await refresh();
      return true;
    } catch (actionError) {
      setMessage(getTextbookActionErrorMessage(actionError));
      return false;
    } finally {
      setSaving("");
    }
  }

  function submitMaster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const masterPayload = {
      ...masterForm,
      category: buildTextbookCategoryValue(masterForm) || masterForm.category,
    };
    void runAction("master", () => textbookService.upsertTextbookMaster(masterPayload), "교재 마스터가 저장되었습니다.").then((ok) => {
      if (ok) {
        setMasterDialogOpen(false);
        setMasterForm(emptyMasterForm);
      }
    });
  }

  function submitPurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const purchasePayload = {
      ...purchaseForm,
      textbookId: selectedPurchaseTextbookId || purchaseForm.textbookId,
      requestedTextbookTitle: purchaseRequestTitle,
      supplierId: configuredPurchaseSupplierId,
      unitCost: String(configuredPurchaseUnitCost),
      locationId: selectedLocationId,
      purchaseOrderId: getRecordId(selectedPurchaseOrder),
      purchaseOrderLineId: selectedPurchaseLineId,
      createdBy: currentUserId,
    };
    void runAction(
      "purchase",
      () => selectedPurchaseLineId
        ? textbookService.updatePurchaseLifecycle(purchasePayload)
        : textbookService.createPurchaseReceipt(purchasePayload),
      selectedPurchaseLineId
        ? `${purchaseActionLabel(purchaseForm.requestStage)}로 업데이트했습니다.`
        : `${purchaseActionLabel(purchaseForm.requestStage)}되었습니다.`,
    ).then((ok) => {
      if (ok) {
        setPurchaseDialogOpen(false);
        setSelectedPurchaseLineId("");
        setPurchaseForm(emptyPurchaseForm);
      }
    });
  }

  function submitSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runAction(
      "sale",
      () => textbookService.createClassTextbookSale(
        { ...saleForm, locationId: saleLocationId, excludedStudentIds },
        data as unknown as Row,
      ),
      "출고 대기 목록에 추가했습니다.",
    ).then((ok) => {
      if (ok) {
        setSaleDialogOpen(false);
        setSaleForm({
          classId: "",
          textbookId: "",
          chargeMonth: currentMonth(),
          locationId: "",
          memo: "",
        });
        setExcludedStudentIds([]);
      }
    });
  }

  function updateSaleLineStatus(line: Row, status: "issued") {
    void runAction(
      `sale-line-${getRecordId(line)}`,
      () => textbookService.updateSaleLineStatus({ saleLineId: getRecordId(line), status, createdBy: currentUserId }, data as unknown as Row),
      "출고가 반영되었습니다.",
    );
  }

  function movePurchaseLine(line: Row, order: Row | undefined, status: PurchaseKanbanStatus, draft?: PurchaseKanbanDraft) {
    if (text(line.status) === status || text(order?.status) === status) {
      return;
    }

    void runAction(
      `purchase-move-${getRecordId(line)}`,
      () => textbookService.updatePurchaseLifecycle(
        draft
          ? buildPurchasePayloadFromDraft(line, order, draft, status)
          : buildPurchaseStatusPayload(line, order, status),
      ),
      "상태가 변경되었습니다.",
    );
  }

  function deletePurchaseLine(line: Row, order: Row | undefined) {
    const confirmed = typeof window === "undefined" || window.confirm("이 요청 건을 삭제할까요?");
    if (!confirmed) {
      return;
    }

    void runAction(
      `purchase-delete-${getRecordId(line)}`,
      () => textbookService.deletePurchaseLifecycle({
        purchaseOrderId: getRecordId(order || {}) || text(line.purchase_order_id || line.purchaseOrderId),
        purchaseOrderLineId: getRecordId(line),
      }),
      "요청 건을 삭제했습니다.",
    );
  }

  function setInventoryCountDraft(row: InventoryCountRow, value: string) {
    setInventoryCountDrafts((current) => ({
      ...current,
      [getInventoryCountDraftKey(row.id, row.locationId)]: value,
    }));
  }

  function setInventoryCountMemoDraft(row: InventoryCountRow, value: string) {
    setInventoryCountMemoDrafts((current) => ({
      ...current,
      [getInventoryCountDraftKey(row.id, row.locationId)]: value,
    }));
  }

  function submitInlineStockCount(row: InventoryCountRow, countedQuantity: string, memo = "") {
    const normalizedQuantity = text(countedQuantity);
    if (!normalizedQuantity) {
      setMessage("실사 수량을 입력하세요.");
      return;
    }

    const draftKey = getInventoryCountDraftKey(row.id, row.locationId);
    void runAction(
      `count-inline-${draftKey}`,
      () => textbookService.createStockCountAdjustment({
        textbookId: row.id,
        locationId: row.locationId,
        countedQuantity: normalizedQuantity,
        expectedQuantity: row.currentQuantity,
        sale_price: getTextbookSalePrice(row.source),
        memo: text(memo),
        createdBy: currentUserId,
      }),
      "실사 수량이 반영되었습니다.",
    ).then((ok) => {
      if (ok) {
        setInventoryCountDrafts((current) => {
          const next = { ...current };
          delete next[draftKey];
          return next;
        });
        setInventoryCountMemoDrafts((current) => {
          const next = { ...current };
          delete next[draftKey];
          return next;
        });
      }
    });
  }

  function submitClosing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (closingNeedsMemo) {
      setMessage("차이가 있으면 사유를 입력하세요.");
      return;
    }
    void runAction(
      "closing",
      () => textbookService.upsertMonthlyClosing(closingForm, data as unknown as Row),
      "월마감 초안이 저장되었습니다.",
    ).then((ok) => {
      if (ok) {
        setClosingDialogOpen(false);
      }
    });
  }

  return (
    <div className="flex min-h-[calc(100dvh-5rem)] flex-col gap-4 px-4 py-4 lg:px-6">
      {error || message ? (
        <Alert variant={error ? "destructive" : "default"}>
          <AlertDescription>{error || message}</AlertDescription>
        </Alert>
      ) : null}
      {schemaDisabled ? (
        <Alert variant="destructive">
          <AlertDescription>{schemaMessage}</AlertDescription>
        </Alert>
      ) : null}
      <datalist id="textbook-category-options">
        {categoryGroupOptions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <datalist id="textbook-publisher-options">
        {publisherGroupOptions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>

      <Dialog open={masterDialogOpen} onOpenChange={(open) => (open ? setMasterDialogOpen(true) : closeMasterDialog())}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] overflow-x-hidden overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{masterForm.id ? "교재 수정" : "교재 신규 등록"}</DialogTitle>
            <DialogDescription className="sr-only">교재명, 학년, 세부과목, 출판사, 판매가, ISBN, 바코드를 등록하거나 수정합니다.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitMaster} className="grid min-w-0 gap-3">
            <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_140px_140px]">
              <Field label="교재명" required>
                <Input
                  value={masterForm.title}
                  onChange={(event) => setMasterForm((current) => ({ ...current, title: event.target.value }))}
                  aria-label="교재명"
                  autoFocus
                  required
                />
              </Field>
              <Field label="과목">
                <Select
                  value={masterForm.subject}
                  onValueChange={(value) =>
                    setMasterForm((current) => ({
                      ...current,
                      subject: value,
                      subSubject: getSubSubjectOptionsForSubject(textbookSubSubjectSettings, value).includes(current.subSubject)
                        ? current.subSubject
                        : "",
                    }))
                  }
                >
                  <SelectTrigger className="w-full" aria-label="과목 선택"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {subjectOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="상태">
                <Select
                  value={masterForm.status}
                  onValueChange={(value) => setMasterForm((current) => ({ ...current, status: value }))}
                >
                  <SelectTrigger className="w-full" aria-label="상태 선택"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {masterDuplicateRows.length > 0 ? (
              <Badge variant="outline" className="w-fit rounded-md border-amber-300 bg-amber-50 text-amber-700">
                중복 의심 {formatQuantity(masterDuplicateRows.length)}건
              </Badge>
            ) : null}
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="학교 구분">
                <Select
                  value={masterForm.schoolLevel || "none"}
                  onValueChange={(value) =>
                    setMasterForm((current) => ({
                      ...current,
                      schoolLevel: value === "none" ? "" : value,
                      gradeLevel: value === "none" || getGradeOptionsForSchoolLevel(value).some((option) => option.value === current.gradeLevel)
                        ? current.gradeLevel
                        : "",
                    }))
                  }
                >
                  <SelectTrigger className="w-full" aria-label="학교 구분 선택"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">미지정</SelectItem>
                    {TEXTBOOK_SCHOOL_LEVEL_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="학년">
                <Select
                  value={masterForm.gradeLevel || "none"}
                  onValueChange={(value) => setMasterForm((current) => ({ ...current, gradeLevel: value === "none" ? "" : value }))}
                >
                  <SelectTrigger className="w-full" aria-label="학년 선택"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">미지정</SelectItem>
                    {masterGradeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="세부과목">
                <SearchCombobox
                  options={[
                    { value: "none", label: "미지정" },
                    ...masterSubSubjectOptions.map((option) => ({ value: option, label: option })),
                  ]}
                  value={masterForm.subSubject || "none"}
                  onValueChange={(value) => setMasterForm((current) => ({ ...current, subSubject: value === "none" ? "" : value }))}
                  placeholder="세부과목 선택"
                  searchPlaceholder="세부과목 검색"
                  emptyLabel="설정된 세부과목이 없습니다"
                  ariaLabel="세부과목 선택"
                />
              </Field>
              <Field label="출판사">
                <Input
                  value={masterForm.publisher}
                  onChange={(event) => setMasterForm((current) => ({ ...current, publisher: event.target.value }))}
                  list="textbook-publisher-options"
                  aria-label="출판사"
                />
              </Field>
              <Field label="판매가">
                <Input
                  value={masterForm.price}
                  onChange={(event) => setMasterForm((current) => ({ ...current, price: event.target.value }))}
                  inputMode="numeric"
                  placeholder="예: 12000"
                  aria-label="판매가"
                />
              </Field>
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
              <Field label="ISBN">
                <Input
                  value={masterForm.isbn13}
                  onChange={(event) => setMasterForm((current) => ({ ...current, isbn13: normalizeBarcodeValue(event.target.value) }))}
                  inputMode="numeric"
                  aria-label="ISBN"
                />
              </Field>
              <Field label="바코드">
                <div className="relative">
                  <Barcode className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    value={masterForm.barcode}
                    onChange={(event) => setMasterForm((current) => ({ ...current, barcode: normalizeBarcodeValue(event.target.value) }))}
                    className="pl-9"
                    inputMode="numeric"
                    aria-label="바코드"
                  />
                </div>
              </Field>
              <div className="flex min-w-0 gap-2">
                <DialogClose asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={closeMasterDialog}
                  >
                    닫기
                  </Button>
                </DialogClose>
                <Button type="submit" className="flex-1" disabled={masterSubmitDisabled}>
                  <Save className="mr-2 size-4" />
                  {masterForm.id ? "수정 저장" : "저장"}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={purchaseDialogOpen} onOpenChange={(open) => (open ? setPurchaseDialogOpen(true) : closePurchaseDialog())}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{getPurchaseDialogTitle(purchaseForm.requestStage, Boolean(selectedPurchaseLineId))}</DialogTitle>
            <DialogDescription className="sr-only">교재 요청, 주문, 입고 단계에 필요한 수량과 연결 정보를 저장합니다.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitPurchase} className="grid gap-3">
            <div
              className={cn(
                "grid gap-3",
                purchaseForm.requestStage === "request"
                  ? "sm:grid-cols-[minmax(220px,1fr)_minmax(180px,0.8fr)]"
                  : "sm:grid-cols-[150px_minmax(220px,1fr)_minmax(180px,0.8fr)]",
              )}
            >
              {purchaseForm.requestStage !== "request" ? (
                <Field label="단계">
                  <Select value={purchaseForm.requestStage} onValueChange={(value) => setPurchaseField("requestStage", value)}>
                    <SelectTrigger className="w-full" aria-label="처리 단계 선택"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="order">공급처 주문</SelectItem>
                      <SelectItem value="receive">입고 처리</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              {purchaseForm.requestStage === "request" ? (
                <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
                  <Field label="등록 교재">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <TextbookSelect
                        textbooks={activeTextbooks}
                        value={explicitPurchaseTextbookId}
                        onValueChange={(value) => setPurchaseField("textbookId", value)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="등록 교재 선택 해제"
                        disabled={!purchaseForm.textbookId}
                        onClick={() => setPurchaseField("textbookId", "")}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  </Field>
                  <Field label="교재명" required>
                    <Input
                      value={purchaseForm.requestedTextbookTitle}
                      onChange={(event) => setPurchaseField("requestedTextbookTitle", event.target.value)}
                      aria-label="요청 교재명"
                      required
                      autoFocus
                    />
                  </Field>
                </div>
              ) : (
                <Field label="등록 교재" required>
                  <TextbookSelect
                    textbooks={activeTextbooks}
                    value={selectedPurchaseTextbookId || purchaseForm.textbookId}
                    onValueChange={(value) => setPurchaseField("textbookId", value)}
                  />
                </Field>
              )}
              <Field label="수업">
                <ClassSelect classes={data.classes} value={purchaseForm.classId} onValueChange={(value) => setPurchaseField("classId", value)} />
              </Field>
            </div>
            {purchaseForm.requestStage !== "request" && purchaseForm.requestedTextbookTitle ? (
              <Badge variant="outline" className="w-fit rounded-md">
                요청 교재명 {purchaseForm.requestedTextbookTitle}
              </Badge>
            ) : null}
            {purchaseForm.requestStage !== "request" ? (
              <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="총판" value={configuredPurchaseSupplierLabel} />
                <Metric label="요청" value={`${formatQuantity(purchaseForm.requestedQuantity)}권`} />
                <Metric label="단가" value={configuredPurchaseUnitCost > 0 ? formatCurrency(configuredPurchaseUnitCost) : "-"} />
                <Metric label="위치" value={getLocationName(locations, selectedLocationId) || "-"} />
              </div>
            ) : null}
            {purchaseFieldVisibility.requester ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {purchaseFieldVisibility.requester ? (
                  <Field label="요청자">
                    <TeacherSelect
                      teachers={data.teacherCatalogs}
                      value={purchaseForm.requestBy}
                      onValueChange={(value) => setPurchaseField("requestBy", value)}
                      ariaLabel="요청자 선택"
                    />
                  </Field>
                ) : null}
              </div>
            ) : null}
            {purchaseFieldVisibility.location || purchaseFieldVisibility.requestedQuantity ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {purchaseFieldVisibility.location ? (
                  <Field label="위치">
                    <LocationSelect
                      locations={locations}
                      value={selectedLocationId}
                      onValueChange={(value) => setPurchaseField("locationId", value)}
                      ariaLabel={purchaseForm.requestStage === "request" ? "요청 위치 선택" : "입고 위치 선택"}
                    />
                  </Field>
                ) : null}
                {purchaseFieldVisibility.requestedQuantity ? (
                  <Field label="요청" required>
                    <Input value={purchaseForm.requestedQuantity} onChange={(event) => setPurchaseField("requestedQuantity", event.target.value)} inputMode="numeric" min="1" aria-label="요청 수량" />
                  </Field>
                ) : null}
              </div>
            ) : null}
            {purchaseFieldVisibility.classFit ? (
              <div className="grid grid-cols-3 gap-2 text-sm">
                <Metric label="학생" value={`학생 ${formatQuantity(purchaseClassStudentCount)}명`} />
                <Metric label="요청" value={`${formatQuantity(purchaseForm.requestedQuantity)}권`} />
                <Metric label="판단" value={purchaseQuantityFit.label} tone={purchaseQuantityFit.tone} />
              </div>
            ) : null}
            {purchaseFieldVisibility.orderedQuantity || purchaseFieldVisibility.receivedQuantity ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {purchaseFieldVisibility.orderedQuantity ? (
                  <Field label="주문" required>
                    <Input value={purchaseForm.orderedQuantity} onChange={(event) => setPurchaseField("orderedQuantity", event.target.value)} inputMode="numeric" min="1" aria-label="주문 수량" />
                  </Field>
                ) : null}
                {purchaseFieldVisibility.receivedQuantity ? (
                  <Field label="입고" required>
                    <Input value={purchaseForm.receivedQuantity} onChange={(event) => setPurchaseField("receivedQuantity", event.target.value)} inputMode="numeric" min="0" aria-label="입고 수량" />
                  </Field>
                ) : null}
              </div>
            ) : null}
            {purchaseFieldVisibility.statementNumber ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="거래명세표">
                  <Input value={purchaseForm.statementNumber} onChange={(event) => setPurchaseField("statementNumber", event.target.value)} aria-label="거래명세표" />
                </Field>
                <div className="flex items-end">
                  <Badge variant="outline" className="h-10 w-full justify-center rounded-md text-sm">
                    {purchaseStageLabels[purchaseForm.requestStage]} · 차이 {formatQuantity(numberValue(purchaseForm.orderedQuantity) - numberValue(purchaseForm.receivedQuantity))}
                  </Badge>
                </div>
              </div>
            ) : null}
            <Field label="메모">
              <Textarea
                value={purchaseForm.memo}
                onChange={(event) => setPurchaseField("memo", event.target.value)}
                rows={2}
                aria-label="요청 메모"
              />
            </Field>
            <div className={dialogFooterClassName}>
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closePurchaseDialog}
                >
                  닫기
                </Button>
              </DialogClose>
              {selectedPurchaseLineId ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={purchaseForm.requestStage === "request" ? openNewRequestDialog : openNewPurchaseDialog}
                >
                  <Plus className="mr-2 size-4" />
                  {purchaseForm.requestStage === "request" ? "새 요청" : "새 주문"}
                </Button>
              ) : null}
              <Button type="submit" disabled={purchaseSubmitDisabled}>
                <Truck className="mr-2 size-4" />
                {selectedPurchaseLineId ? "선택 건 저장" : purchaseActionLabel(purchaseForm.requestStage)}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOrderDialogOpen} onOpenChange={(open) => (open ? setBulkOrderDialogOpen(true) : closeBulkOrderDialog())}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] overflow-x-hidden overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>선택 요청 주문</DialogTitle>
            <DialogDescription className="sr-only">선택한 요청을 공급처 주문 단계로 한꺼번에 전환합니다.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitBulkOrder} className="grid min-w-0 gap-3">
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>교재</TableHead>
                    <TableHead className="w-20 text-right">요청</TableHead>
                    <TableHead className="w-32">주문</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedBulkOrderLines.map((line) => {
                    const lineId = getRecordId(line);
                    const order = getPurchaseLineOrder(line, purchaseOrdersById);
                    const draft = buildPurchaseCardDraft(line, order);
                    const textbook = getOrderablePurchaseRequestTextbook(line, order, data.textbooks);
                    return (
                      <TableRow key={lineId}>
                        <TableCell className="min-w-0">
                          <div className="truncate font-medium">{getPurchaseTextbookTitle(line, textbook)}</div>
                          <div className="text-xs text-muted-foreground">{getPublisherLabel(textbook || {})}</div>
                        </TableCell>
                        <TableCell className="text-right">{formatQuantity(draft.requestedQuantity)}</TableCell>
                        <TableCell>
                          <Input
                            value={bulkOrderQuantities[lineId] ?? draft.requestedQuantity}
                            onChange={(event) => setBulkOrderQuantity(lineId, event.target.value)}
                            inputMode="numeric"
                            min="1"
                            aria-label={`${getPurchaseTextbookTitle(line, textbook)} 주문 수량`}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className={dialogFooterClassName}>
              <DialogClose asChild>
                <Button type="button" variant="outline" onClick={closeBulkOrderDialog}>
                  닫기
                </Button>
              </DialogClose>
              <Button type="submit" disabled={saving === "purchase-bulk-order" || selectedBulkOrderLines.length === 0}>
                <Truck className="mr-2 size-4" />
                주문
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={saleDialogOpen} onOpenChange={(open) => (open ? setSaleDialogOpen(true) : closeSaleDialog())}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>출고 추가</DialogTitle>
            <DialogDescription className="sr-only">수업과 교재를 선택해 학생별 출고 대기 내역을 생성합니다.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitSale} className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="수업" required>
                <ClassSelect classes={data.classes} value={saleForm.classId} onValueChange={(value) => {
                  setSaleField("classId", value);
                  setExcludedStudentIds([]);
                }} />
              </Field>
              <Field label="교재" required>
                <TextbookSelect textbooks={activeTextbooks} value={saleForm.textbookId} onValueChange={(value) => setSaleField("textbookId", value)} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="출고월">
                <Input type="month" value={saleForm.chargeMonth} onChange={(event) => setSaleField("chargeMonth", event.target.value)} aria-label="출고월" />
              </Field>
              <Field label="위치">
                <LocationSelect locations={locations} value={saleLocationId} onValueChange={(value) => setSaleField("locationId", value)} ariaLabel="출고 위치 선택" />
              </Field>
            </div>

            <div className="rounded-md border">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <span className="text-sm font-medium">학생</span>
                <Badge variant="secondary">{formatQuantity(saleDraft.lines.length)}명</Badge>
              </div>
              <div className="max-h-56 overflow-y-auto p-2">
                {selectedClassStudents.length > 0 ? selectedClassStudents.map((student) => {
                  const id = getRecordId(student);
                  const checked = !excludedStudentIds.includes(id);
                  return (
                    <label key={id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) => {
                          setExcludedStudentIds((current) =>
                            value ? current.filter((item) => item !== id) : [...new Set([...current, id])],
                          );
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate">{getStudentName(student)}</span>
                    </label>
                  );
                }) : (
                  <div className="px-2 py-6 text-center text-sm text-muted-foreground">수업을 선택하세요</div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-sm">
              <Metric label="수량" value={`${formatQuantity(saleDraft.totalQuantity)}권`} />
              <Metric label="재고" value={`${formatQuantity(saleDraft.availableQuantity)}권`} />
              <Metric label="부족" value={`${formatQuantity(saleDraft.stockShortage)}권`} tone={saleDraft.hasStockShortage ? "danger" : "default"} />
            </div>
            <div className={dialogFooterClassName}>
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeSaleDialog}
                >
                  닫기
                </Button>
              </DialogClose>
              <Button type="submit" disabled={schemaDisabled || saving === "sale" || saleSubmitDisabled}>
                <Check className="mr-2 size-4" />
                출고 대기 저장
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={closingDialogOpen} onOpenChange={(open) => (open ? setClosingDialogOpen(true) : closeClosingDialog())}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>월마감</DialogTitle>
            <DialogDescription className="sr-only">월별 입고, 출고, 기말 수량과 금액 차이를 정산합니다.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitClosing} className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="월" required>
                <Input type="month" value={closingForm.closingMonth} onChange={(event) => setClosingForm((current) => ({ ...current, closingMonth: event.target.value }))} aria-label="마감 월" />
              </Field>
              <Field label="과목">
                <Select value={closingForm.subject} onValueChange={(value) => setClosingForm((current) => ({ ...current, subject: value }))}>
                  <SelectTrigger className="w-full" aria-label="마감 과목 선택"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체</SelectItem>
                    <SelectItem value="english">영어</SelectItem>
                    <SelectItem value="math">수학</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="기초 수량">
                <Input value={closingForm.openingQuantity} onChange={(event) => setClosingForm((current) => ({ ...current, openingQuantity: event.target.value }))} inputMode="numeric" aria-label="기초 수량" />
              </Field>
              <Field label="기초 금액">
                <Input value={closingForm.openingAmount} onChange={(event) => setClosingForm((current) => ({ ...current, openingAmount: event.target.value }))} inputMode="numeric" aria-label="기초 금액" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Metric label="입고" value={`${formatQuantity(closingPreview.purchaseQuantity)}권`} />
              <Metric label="출고" value={`${formatQuantity(closingPreview.saleQuantity)}권`} />
              <Metric label="기말" value={`${formatQuantity(closingPreview.endingQuantity)}권`} />
              <Metric label="차이" value={closingNeedsMemo ? "사유 필요" : formatCurrency(closingPreview.settlementDifference)} tone={closingPreview.needsReview ? "danger" : "default"} />
            </div>
            <Field label="메모">
              <Textarea value={closingForm.memo} onChange={(event) => setClosingForm((current) => ({ ...current, memo: event.target.value }))} rows={3} aria-label="마감 메모" />
            </Field>
            <div className={dialogFooterClassName}>
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeClosingDialog}
                >
                  닫기
                </Button>
              </DialogClose>
              <Button type="submit" disabled={schemaDisabled || saving === "closing" || closingNeedsMemo}>
                <ClipboardCheck className="mr-2 size-4" />
                마감 저장
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Tabs value={activeTab} onValueChange={changeActiveTab} className="min-h-0 min-w-0 flex-1">
        <TabsList className="grid h-auto w-full grid-cols-2 rounded-md border bg-background p-1 sm:grid-cols-3 lg:grid-cols-6">
          <TabsTrigger value="master" className={textbookTabTriggerClassName}>
            <BookOpen className="size-4" />
            마스터
            <TabCountBadge value={data.textbooks.length} />
          </TabsTrigger>
          <TabsTrigger value="requests" className={textbookTabTriggerClassName}>
            <Pencil className="size-4" />
            요청
            <TabCountBadge value={operationMetrics.requestCount} showZero />
          </TabsTrigger>
          <TabsTrigger value="purchase" className={textbookTabTriggerClassName}>
            <Truck className="size-4" />
            주문·입고
            <TabCountBadge value={operationMetrics.receivingBacklogCount} showZero />
          </TabsTrigger>
          <TabsTrigger value="sales" className={textbookTabTriggerClassName}>
            <Check className="size-4" />
            출고
            <TabCountBadge value={operationMetrics.issueWaitingCount} showZero />
          </TabsTrigger>
          <TabsTrigger value="inventory" className={textbookTabTriggerClassName}>
            <PackageCheck className="size-4" />
            재고
            <TabCountBadge value={data.inventory.length} />
          </TabsTrigger>
          <TabsTrigger value="closing" className={textbookTabTriggerClassName}>
            <ClipboardCheck className="size-4" />
            정산
            <TabCountBadge value={data.monthlyClosings.length} showZero />
          </TabsTrigger>
        </TabsList>

        {loading ? (
          <TextbookLoadingState />
        ) : (
          <>
            <TextbookOpsCommandCenter
              metrics={operationMetrics}
              activeQueueKey={activeQueueKey}
              onSelectQueue={openTextbookOpsQueue}
            />

        {showsProcessSearch ? (
          <div className="mt-3">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={operationQuery}
                onChange={(event) => setOperationQuery(event.target.value)}
                className="pl-9 pr-9"
                placeholder="교재명, 수업, 학생, 요청자"
                aria-label="업무 검색"
              />
              {operationQuery ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1 size-8"
                  aria-label="업무 검색 초기화"
                  onClick={() => setOperationQuery("")}
                >
                  <X className="size-4" />
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {showsInventoryTools ? (
          <div className="mt-3 grid gap-3">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="pl-9 pr-9"
                  placeholder="교재명, ISBN, 바코드"
                  aria-label="교재 검색"
                />
                {query ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1 size-8"
                    aria-label="검색 초기화"
                    onClick={() => setQuery("")}
                  >
                    <X className="size-4" />
                  </Button>
                ) : null}
              </div>
              {activeTab === "master" ? (
                <Button type="button" className="shrink-0" onClick={openNewMasterDialog}>
                  <Plus className="mr-2 size-4" />
                  신규 등록
                </Button>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="h-8 rounded-md px-2">
                표시 {formatQuantity(filteredInventory.length)}종
              </Badge>
              <Badge variant="outline" className="h-8 rounded-md px-2">
                재고 {formatQuantity(filteredInventoryTotalQuantity)}권
              </Badge>
              {activeTab === "master" ? (
                <Badge variant="outline" className="h-8 rounded-md px-2">
                  판매가합 {formatCurrency(filteredInventorySaleValue)}
                </Badge>
              ) : null}
              {selectedTextbookRows.length > 0 ? (
                <Badge variant="default" className="h-8 rounded-md px-2">
                  선택 {formatQuantity(selectedTextbookRows.length)}
                </Badge>
              ) : null}
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="h-8 rounded-md">
                    <SlidersHorizontal className="mr-2 size-3.5" />
                    목록 필터
                    <span className="ml-2 rounded bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
                      {inventoryFilterLabels[inventoryFilter]}
                      {activeTab === "master" ? ` · ${textbookQualityFilterLabels[textbookQualityFilter]}` : ""}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[min(32rem,calc(100vw-2rem))] p-3">
                  <div className="grid gap-3">
                    <div className="grid gap-1.5">
                      <p className="text-xs font-medium text-muted-foreground">재고 상태</p>
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                        {(Object.keys(inventoryFilterLabels) as InventoryFilter[]).map((filter) => (
                          <Button
                            key={filter}
                            type="button"
                            variant={inventoryFilter === filter ? "default" : "outline"}
                            size="sm"
                            className="h-8 justify-start rounded-md"
                            aria-pressed={inventoryFilter === filter}
                            onClick={() => setInventoryFilter(filter)}
                          >
                            <span className="min-w-0 truncate">{inventoryFilterLabels[filter]}</span>
                            <span className={cn(
                              "ml-auto rounded px-1.5 text-[11px] font-semibold",
                              inventoryFilter === filter ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
                            )}>
                              {formatQuantity(inventoryFilterCounts[filter])}
                            </span>
                          </Button>
                        ))}
                      </div>
                    </div>
                    {activeTab === "master" ? (
                      <div className="grid gap-1.5">
                        <p className="text-xs font-medium text-muted-foreground">정리 상태</p>
                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                          {(Object.keys(textbookQualityFilterLabels) as TextbookQualityFilter[]).map((filter) => (
                            <Button
                              key={filter}
                              type="button"
                              variant={textbookQualityFilter === filter ? "default" : "outline"}
                              size="sm"
                              className="h-8 justify-start rounded-md"
                              aria-pressed={textbookQualityFilter === filter}
                              onClick={() => setTextbookQualityFilter(filter)}
                            >
                              <span className="min-w-0 truncate">{textbookQualityFilterLabels[filter]}</span>
                              <span className={cn(
                                "ml-auto rounded px-1.5 text-[11px] font-semibold",
                                textbookQualityFilter === filter ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
                              )}>
                                {formatQuantity(textbookQualityFilterCounts[filter])}
                              </span>
                            </Button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </PopoverContent>
              </Popover>
              {hasTextbookListFilter ? (
                <Button type="button" variant="ghost" size="sm" className="h-8 rounded-md" onClick={resetTextbookListFilters}>
                  필터 초기화
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {showsInventoryTools ? (
          <TextbookListControls
            subjectFilter={subjectGroupFilter}
            onSubjectFilterChange={(value) => {
              setSubjectGroupFilter(value);
              setCategoryGroupFilter("all");
            }}
            schoolLevelFilter={schoolLevelGroupFilter}
            onSchoolLevelFilterChange={(value) => {
              setSchoolLevelGroupFilter(value);
              setGradeLevelGroupFilter("all");
            }}
            gradeLevelFilter={gradeLevelGroupFilter}
            onGradeLevelFilterChange={setGradeLevelGroupFilter}
            gradeLevelOptions={gradeLevelGroupOptions}
            categoryFilter={categoryGroupFilter}
            onCategoryFilterChange={setCategoryGroupFilter}
            categoryOptions={categoryGroupOptions}
            groupCount={visibleTextbookGroupLabels.length}
            onCollapseAllGroups={collapseVisibleTextbookGroups}
            onExpandAllGroups={expandVisibleTextbookGroups}
          />
        ) : null}

        <TabsContent value="master" className="mt-4 grid min-w-0 gap-4">
          <TextbookBulkActionBar
            selectedCount={selectedTextbookRows.length}
            patch={bulkTextbookPatch}
            categoryOptions={categoryGroupOptions}
            publisherOptions={publisherGroupOptions}
            saving={saving}
            onPatchChange={setBulkTextbookPatchField}
            onApply={applyBulkTextbookEdit}
            onSetStatus={applyBulkTextbookStatus}
            onDelete={deleteSelectedTextbooks}
            onClear={() => setSelectedTextbookIds([])}
          />

          <TextbookTable
            rows={filteredInventory}
            locations={locations}
            onSelectTextbook={selectMasterTextbook}
            amountMode="salePrice"
            duplicateTitleKeys={duplicateTextbookTitleKeys}
            collapsedGroups={collapsedTextbookGroups}
            onToggleGroup={toggleTextbookGroup}
            selectedIds={selectedTextbookIds}
            allVisibleSelected={allVisibleTextbooksSelected}
            someVisibleSelected={someVisibleTextbooksSelected}
            onToggleAllVisible={toggleAllVisibleTextbooks}
            onBulkSelectionChange={toggleTextbookSelection}
            emptyLabel={textbookEmptyLabel}
          />
        </TabsContent>

        <TabsContent value="requests" className="mt-4 grid min-w-0 gap-4">
          <PurchaseProcessTable
            mode="request"
            orders={data.purchaseOrders}
            lines={data.purchaseOrderLines}
            textbooks={data.textbooks}
            locations={locations}
            suppliers={data.suppliers}
            publisherSupplierLinks={data.publisherSupplierLinks}
            classes={data.classes}
            students={data.students}
            selectedLineId={selectedPurchaseLineId}
            selectedLineIds={selectedPurchaseLineIds}
            boardScope={purchaseBoardScope}
            requestFilter={purchaseRequestFilter}
            orderFilter={purchaseOrderFilter}
            searchQuery={operationQuery}
            saving={saving}
            onAddLine={openNewRequestDialog}
            onSelectLine={selectPurchaseLine}
            onRegisterTextbook={openMasterFromPurchaseRequest}
            onToggleLine={togglePurchaseLineSelection}
            onToggleVisibleLines={toggleVisiblePurchaseLineSelection}
            onBulkOrder={openBulkOrderDialog}
            onScopeChange={setPurchaseBoardScope}
            onRequestFilterChange={setPurchaseRequestFilter}
            onOrderFilterChange={setPurchaseOrderFilter}
            onMoveLine={movePurchaseLine}
            onDeleteLine={deletePurchaseLine}
          />
        </TabsContent>

        <TabsContent value="purchase" className="mt-4 grid min-w-0 gap-4">
          <PurchaseProcessTable
            mode="order"
            orders={data.purchaseOrders}
            lines={data.purchaseOrderLines}
            textbooks={data.textbooks}
            locations={locations}
            suppliers={data.suppliers}
            publisherSupplierLinks={data.publisherSupplierLinks}
            classes={data.classes}
            students={data.students}
            selectedLineId={selectedPurchaseLineId}
            boardScope={purchaseBoardScope}
            requestFilter={purchaseRequestFilter}
            orderFilter={purchaseOrderFilter}
            searchQuery={operationQuery}
            saving={saving}
            onAddLine={openNewPurchaseDialog}
            onSelectLine={selectPurchaseLine}
            onRegisterTextbook={openMasterFromPurchaseRequest}
            onScopeChange={setPurchaseBoardScope}
            onRequestFilterChange={setPurchaseRequestFilter}
            onOrderFilterChange={setPurchaseOrderFilter}
            onMoveLine={movePurchaseLine}
            onDeleteLine={deletePurchaseLine}
          />
        </TabsContent>

        <TabsContent value="sales" className="mt-4 grid min-w-0 gap-4">
          <SalesProcessTable
            sales={data.sales}
            lines={data.saleLines}
            textbooks={data.textbooks}
            classes={data.classes}
            locations={locations}
            saving={saving}
            statusFilter={salesProcessFilter}
            searchQuery={operationQuery}
            onStatusFilterChange={setSalesProcessFilter}
            onAddSale={openNewSaleDialog}
            onUpdateStatus={updateSaleLineStatus}
          />
        </TabsContent>

        <TabsContent value="inventory" className="mt-4 grid min-w-0 gap-4">
          <InventoryCountWorkspace
            rows={filteredInventory}
            stockCounts={data.stockCounts}
            locations={locations}
            locationId={selectedInventoryCountLocationId}
            auditFilter={inventoryAuditFilter}
            countDrafts={inventoryCountDrafts}
            memoDrafts={inventoryCountMemoDrafts}
            saving={saving}
            schemaDisabled={schemaDisabled}
            duplicateTitleKeys={duplicateTextbookTitleKeys}
            collapsedGroups={collapsedTextbookGroups}
            onToggleGroup={toggleTextbookGroup}
            onLocationChange={setInventoryCountLocationId}
            onFilterChange={setInventoryAuditFilter}
            onDraftChange={setInventoryCountDraft}
            onMemoChange={setInventoryCountMemoDraft}
            onSubmitCount={submitInlineStockCount}
            emptyLabel={textbookEmptyLabel}
          />
          <InventoryHistoryPanel
            stockMoves={data.stockMoves}
            stockCounts={data.stockCounts}
            textbooks={data.textbooks}
            locations={locations}
            currentUserId={currentUserId}
            currentUserLabel={currentUserLabel}
          />
        </TabsContent>

            <TabsContent value="closing" className="mt-4 grid min-w-0 gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="h-8 rounded-md px-2">
                    마감 {formatQuantity(data.monthlyClosings.length)}건
                  </Badge>
                  <Badge variant="outline" className="h-8 rounded-md px-2">
                    최근 {formatQuantity(Math.min(data.monthlyClosings.length, 12))}건
                  </Badge>
                </div>
                <Button type="button" onClick={openClosingDialog}>
                  <ClipboardCheck className="mr-2 size-4" />
                  월마감 추가
                </Button>
              </div>
              <MonthlyClosingTable rows={data.monthlyClosings} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}

function Field({ label, children, required = false }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
        {required ? <span className="ml-1 text-destructive">*</span> : null}
      </Label>
      {children}
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "danger" | "warning" | "good" }) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2",
        tone === "danger" && "border-red-300 bg-red-50 text-red-700",
        tone === "warning" && "border-amber-300 bg-amber-50 text-amber-700",
        tone === "good" && "border-emerald-300 bg-emerald-50 text-emerald-700",
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function TabCountBadge({ value, showZero = false }: { value: number; showZero?: boolean }) {
  if (value <= 0 && !showZero) return null;
  return (
    <Badge variant="secondary" className="ml-1 h-5 rounded px-1.5 text-[11px] leading-none">
      {formatQuantity(value)}
    </Badge>
  );
}

function TextbookLoadingState() {
  return (
    <div className="mt-3 grid gap-2 rounded-lg border bg-muted/10 p-3" aria-label="교재관리 로딩">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <div className="grid gap-2 md:grid-cols-3">
        <div className="h-16 animate-pulse rounded-md bg-muted" />
        <div className="h-16 animate-pulse rounded-md bg-muted" />
        <div className="h-16 animate-pulse rounded-md bg-muted" />
      </div>
    </div>
  );
}

type SearchSelectOption = {
  value: string;
  label: string;
  description?: string;
  searchText?: string;
};

function SearchCombobox({
  options,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  ariaLabel,
}: {
  options: SearchSelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className="w-full justify-between gap-2 px-3 font-normal"
        >
          <span className={cn("min-w-0 flex-1 truncate text-left", !selected && "text-muted-foreground")}>
            {selected?.label || placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(520px,calc(100vw-2rem))] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="max-h-72">
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.description || ""} ${option.searchText || ""} ${option.value}`}
                  onSelect={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-4", option.value === value ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.description ? (
                    <span className="shrink-0 text-xs text-muted-foreground">{option.description}</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function TextbookSelect({ textbooks, value, onValueChange }: { textbooks: Row[]; value: string; onValueChange: (value: string) => void }) {
  const options = textbooks.map((textbook) => ({
    value: getRecordId(textbook),
    label: getTextbookTitle(textbook),
    description: getSubjectLabel(textbook.subject),
    searchText: [
      textbook.publisher,
      textbook.category,
      getTaxonomyCategoryLabel(textbook),
      getTextbookSchoolLevelLabel(getTextbookSchoolLevel(textbook)),
      getTextbookGradeLabel(getTextbookGradeLevel(textbook)),
      getTextbookSubSubject(textbook),
      textbook.isbn13,
      textbook.barcode,
    ].map(text).join(" "),
  }));

  return (
    <SearchCombobox
      options={options}
      value={value}
      onValueChange={onValueChange}
      placeholder="교재 선택"
      searchPlaceholder="교재명, 출판사, ISBN"
      emptyLabel="교재가 없습니다"
      ariaLabel="교재 선택"
    />
  );
}

function ClassSelect({ classes, value, onValueChange }: { classes: Row[]; value: string; onValueChange: (value: string) => void }) {
  const options = classes.map((classItem) => ({
    value: getRecordId(classItem),
    label: getClassName(classItem),
    searchText: [classItem.teacher, classItem.teacher_name, classItem.teacherName].map(text).join(" "),
  }));

  return (
    <SearchCombobox
      options={options}
      value={value}
      onValueChange={onValueChange}
      placeholder="수업 선택"
      searchPlaceholder="수업명, 담당"
      emptyLabel="수업이 없습니다"
      ariaLabel="수업 선택"
    />
  );
}

function TeacherSelect({
  teachers,
  value,
  onValueChange,
  ariaLabel = "선생님 선택",
}: {
  teachers: Row[];
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const teacherNames = [...new Set(teachers.map(getTeacherName).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "ko"));
  const hasCustomValue = Boolean(value) && !teacherNames.includes(value);

  return (
    <Select value={value || "none"} onValueChange={(nextValue) => onValueChange(nextValue === "none" ? "" : nextValue)}>
      <SelectTrigger className="w-full" aria-label={ariaLabel}><SelectValue placeholder="선생님 선택" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">미지정</SelectItem>
        {hasCustomValue ? <SelectItem value={value}>{value}</SelectItem> : null}
        {teacherNames.map((teacher) => (
          <SelectItem key={teacher} value={teacher}>
            {teacher}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LocationSelect({
  locations,
  value,
  onValueChange,
  ariaLabel = "위치 선택",
}: {
  locations: Row[];
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel?: string;
}) {
  return (
    <Select value={value || undefined} onValueChange={onValueChange}>
      <SelectTrigger className="w-full" aria-label={ariaLabel}><SelectValue placeholder="위치" /></SelectTrigger>
      <SelectContent>
        {locations.map((location) => (
          <SelectItem key={getRecordId(location)} value={getRecordId(location)}>
            {text(location.name || location.code)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TextbookListControls({
  subjectFilter,
  onSubjectFilterChange,
  schoolLevelFilter,
  onSchoolLevelFilterChange,
  gradeLevelFilter,
  onGradeLevelFilterChange,
  gradeLevelOptions,
  categoryFilter,
  onCategoryFilterChange,
  categoryOptions,
  groupCount,
  onCollapseAllGroups,
  onExpandAllGroups,
}: {
  subjectFilter: string;
  onSubjectFilterChange: (value: string) => void;
  schoolLevelFilter: string;
  onSchoolLevelFilterChange: (value: string) => void;
  gradeLevelFilter: string;
  onGradeLevelFilterChange: (value: string) => void;
  gradeLevelOptions: typeof TEXTBOOK_GRADE_OPTIONS;
  categoryFilter: string;
  onCategoryFilterChange: (value: string) => void;
  categoryOptions: string[];
  groupCount: number;
  onCollapseAllGroups: () => void;
  onExpandAllGroups: () => void;
}) {
  const categorySelectOptions = [
    { value: "all", label: "전체 세부과목" },
    ...categoryOptions.map((category) => ({ value: category, label: category })),
  ];
  const schoolLevelSelectOptions = [
    { value: "all", label: "전체 학교 구분" },
    ...TEXTBOOK_SCHOOL_LEVEL_OPTIONS,
  ];
  const gradeLevelSelectOptions = [
    { value: "all", label: "전체 학년" },
    ...gradeLevelOptions,
  ];
  const activeFilterLabel = [
    subjectFilter === "all" ? "" : subjectOptions.find((option) => option.value === subjectFilter)?.label,
    categoryFilter === "all" ? "" : categoryFilter,
    schoolLevelFilter === "all" ? "" : schoolLevelSelectOptions.find((option) => option.value === schoolLevelFilter)?.label,
    gradeLevelFilter === "all" ? "" : gradeLevelSelectOptions.find((option) => option.value === gradeLevelFilter)?.label,
  ]
    .filter(Boolean)
    .join(" · ") || "전체";

  return (
    <div className="mt-3 overflow-hidden rounded-lg border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/20 p-2" aria-label="교재 분류 필터">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" size="sm" variant="outline" className="h-8 rounded-md">
                <SlidersHorizontal className="mr-2 size-3.5" />
                분류 필터
                <span className="ml-2 max-w-[10rem] truncate rounded bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
                  {activeFilterLabel}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(28rem,calc(100vw-2rem))] p-3">
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <p className="text-xs font-medium text-muted-foreground">과목</p>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    <Button
                      type="button"
                      size="sm"
                      variant={subjectFilter === "all" ? "default" : "outline"}
                      className="h-8 justify-start rounded-md"
                      aria-pressed={subjectFilter === "all"}
                      onClick={() => onSubjectFilterChange("all")}
                    >
                      전체 과목
                    </Button>
                    {subjectOptions.map((option) => (
                      <Button
                        key={option.value}
                        type="button"
                        size="sm"
                        variant={subjectFilter === option.value ? "default" : "outline"}
                        className="h-8 justify-start rounded-md"
                        aria-pressed={subjectFilter === option.value}
                        onClick={() => onSubjectFilterChange(option.value)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                  <SearchCombobox
                    options={categorySelectOptions}
                    value={categoryFilter}
                    onValueChange={onCategoryFilterChange}
                    placeholder="세부과목 선택"
                    searchPlaceholder="세부과목 검색"
                    emptyLabel="세부과목이 없습니다"
                    ariaLabel="세부과목 필터"
                  />
                </div>
                <div className="grid gap-2">
                  <p className="text-xs font-medium text-muted-foreground">학교 구분</p>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {schoolLevelSelectOptions.map((option) => (
                      <Button
                        key={option.value}
                        type="button"
                        size="sm"
                        variant={schoolLevelFilter === option.value ? "default" : "outline"}
                        className="h-8 justify-start rounded-md"
                        aria-pressed={schoolLevelFilter === option.value}
                        onClick={() => onSchoolLevelFilterChange(option.value)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                  <SearchCombobox
                    options={gradeLevelSelectOptions}
                    value={gradeLevelFilter}
                    onValueChange={onGradeLevelFilterChange}
                    placeholder="학년 선택"
                    searchPlaceholder="학년 검색"
                    emptyLabel="학년이 없습니다"
                    ariaLabel="학년 필터"
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>
          {groupCount > 0 ? (
            <Badge variant="secondary" className="h-8 rounded-md px-2">
              {formatQuantity(groupCount)}그룹
            </Badge>
          ) : null}
        </div>
        {groupCount > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" className="h-8 rounded-md" onClick={onCollapseAllGroups}>
              전체 접기
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-8 rounded-md" onClick={onExpandAllGroups}>
              전체 펼치기
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TextbookBulkActionBar({
  selectedCount,
  patch,
  categoryOptions,
  publisherOptions,
  saving,
  onPatchChange,
  onApply,
  onSetStatus,
  onDelete,
  onClear,
}: {
  selectedCount: number;
  patch: typeof emptyBulkTextbookPatch;
  categoryOptions: string[];
  publisherOptions: string[];
  saving: string;
  onPatchChange: (name: keyof typeof emptyBulkTextbookPatch, value: string) => void;
  onApply: () => void;
  onSetStatus: (status: string) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  if (selectedCount === 0) {
    return null;
  }

  const hasPatch =
    patch.subject !== "keep" ||
    text(patch.category) ||
    text(patch.publisher) ||
    text(patch.price) ||
    patch.status !== "keep";

  return (
    <div className="sticky bottom-3 z-20 grid gap-2 rounded-lg border bg-primary/5 p-3 shadow-lg backdrop-blur lg:grid-cols-[auto_120px_160px_160px_130px_120px_auto] lg:items-end">
      <div className="flex h-9 items-center gap-2 text-sm font-medium">
        <Badge variant="secondary">{formatQuantity(selectedCount)}개 선택</Badge>
      </div>
      <Field label="과목">
        <Select value={patch.subject} onValueChange={(value) => onPatchChange("subject", value)}>
          <SelectTrigger className="h-9" aria-label="일괄 과목 선택"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="keep">과목 유지</SelectItem>
            {subjectOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="세부과목">
        <Input
          value={patch.category}
          onChange={(event) => onPatchChange("category", event.target.value)}
          list="textbook-category-options"
          placeholder={categoryOptions.length > 0 ? "유지 또는 선택" : "유지"}
          className="h-9"
          aria-label="일괄 세부과목"
        />
      </Field>
      <Field label="출판사">
        <Input
          value={patch.publisher}
          onChange={(event) => onPatchChange("publisher", event.target.value)}
          list="textbook-publisher-options"
          placeholder={publisherOptions.length > 0 ? "유지 또는 선택" : "유지"}
          className="h-9"
          aria-label="일괄 출판사"
        />
      </Field>
      <Field label="상태">
        <Select value={patch.status} onValueChange={(value) => onPatchChange("status", value)}>
          <SelectTrigger className="h-9" aria-label="일괄 상태 선택"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="keep">상태 유지</SelectItem>
            {statusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="판매가">
        <Input value={patch.price} onChange={(event) => onPatchChange("price", event.target.value)} placeholder="예: 12000" className="h-9" inputMode="numeric" aria-label="일괄 판매가" />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="outline" className="h-9" disabled={saving === "textbook-bulk-status"} onClick={() => onSetStatus("active")}>
          <Check className="mr-2 size-4" />
          사용 전환
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-9" disabled={saving === "textbook-bulk-status"} onClick={() => onSetStatus("inactive")}>
          <X className="mr-2 size-4" />
          미사용 처리
        </Button>
        <Button type="button" size="sm" className="h-9" disabled={!hasPatch || saving === "textbook-bulk-edit"} onClick={onApply}>
          <Save className="mr-2 size-4" />
          일괄 수정
        </Button>
        <Button type="button" size="sm" variant="destructive" className="h-9" disabled={saving === "textbook-bulk-delete"} onClick={onDelete}>
          <Trash2 className="mr-2 size-4" />
          일괄 삭제
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-9" onClick={onClear}>
          선택 해제
        </Button>
      </div>
    </div>
  );
}

function getInventoryCountStatusClassName(row: InventoryCountRow) {
  if (row.status === "done") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (row.isRecommended) return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function InventoryCountWorkspace({
  rows,
  stockCounts,
  locations,
  locationId,
  auditFilter,
  countDrafts,
  memoDrafts,
  saving,
  schemaDisabled,
  duplicateTitleKeys = new Set<string>(),
  collapsedGroups = [],
  onToggleGroup,
  onLocationChange,
  onFilterChange,
  onDraftChange,
  onMemoChange,
  onSubmitCount,
  emptyLabel = "교재가 없습니다",
}: {
  rows: Row[];
  stockCounts: Row[];
  locations: Row[];
  locationId: string;
  auditFilter: InventoryAuditFilter;
  countDrafts: Record<string, string>;
  memoDrafts: Record<string, string>;
  saving: string;
  schemaDisabled: boolean;
  duplicateTitleKeys?: Set<string>;
  collapsedGroups?: string[];
  onToggleGroup?: (label: string) => void;
  onLocationChange: (value: string) => void;
  onFilterChange: (value: InventoryAuditFilter) => void;
  onDraftChange: (row: InventoryCountRow, value: string) => void;
  onMemoChange: (row: InventoryCountRow, value: string) => void;
  onSubmitCount: (row: InventoryCountRow, countedQuantity: string, memo: string) => void;
  emptyLabel?: string;
}) {
  const countRows = useMemo(
    () => buildInventoryCountRows({ rows, stockCounts, locations, locationId }),
    [locationId, locations, rows, stockCounts],
  );
  const filterCounts = useMemo(
    () => Object.fromEntries(
      (Object.keys(inventoryAuditFilterLabels) as InventoryAuditFilter[]).map((filter) => [
        filter,
        filter === "all" ? countRows.length : countRows.filter((row) => row.status === filter).length,
      ]),
    ) as Record<InventoryAuditFilter, number>,
    [countRows],
  );
  const visibleRows = auditFilter === "all" ? countRows : countRows.filter((row) => row.status === auditFilter);
  const groupedRows = visibleRows.reduce<Array<{ label: string; rows: InventoryCountRow[] }>>((groups, row) => {
    const label = getTextbookGroupLabel(row.source);
    const group = groups.find((item) => item.label === label);
    if (group) {
      group.rows.push(row);
      return groups;
    }
    groups.push({ label, rows: [row] });
    return groups;
  }, []).sort((left, right) => compareTextbookGroupLabels(left.label, right.label));
  const currentLocation = getLocationName(locations, locationId) || "위치";

  return (
    <section className="grid min-w-0 gap-3">
      <div className="flex flex-col gap-2 rounded-lg border bg-background p-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-2 sm:flex sm:items-center">
          <LocationSelect
            locations={locations}
            value={locationId}
            onValueChange={onLocationChange}
            ariaLabel="실사 위치 선택"
          />
          <Badge variant="secondary" className="h-9 justify-center rounded-md px-3 sm:justify-start">
            {currentLocation} {formatQuantity(visibleRows.length)}권
          </Badge>
          <Badge variant="outline" className="h-9 justify-center rounded-md px-3 text-xs font-normal text-muted-foreground sm:justify-start">
            월 1회 · 30일 경과 · 이력 없음 · 재고 {formatQuantity(INVENTORY_LOW_STOCK_THRESHOLD)}권 이하
          </Badge>
        </div>
        <div className="grid grid-cols-4 gap-1 sm:flex sm:flex-wrap">
          {(Object.keys(inventoryAuditFilterLabels) as InventoryAuditFilter[]).map((filter) => (
            <Button
              key={filter}
              type="button"
              size="sm"
              variant={auditFilter === filter ? "default" : "outline"}
              className="h-9 justify-center gap-1 px-2"
              aria-pressed={auditFilter === filter}
              onClick={() => onFilterChange(filter)}
            >
              <span>{inventoryAuditFilterLabels[filter]}</span>
              <span className={cn(
                "rounded bg-muted px-1.5 text-xs",
                auditFilter === filter && "bg-primary-foreground/20",
              )}>
                {formatQuantity(filterCounts[filter])}
              </span>
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:hidden">
        {visibleRows.map((row) => {
          const draftKey = getInventoryCountDraftKey(row.id, row.locationId);
          return (
            <InventoryCountMobileCard
              key={draftKey}
              row={row}
              value={countDrafts[draftKey] || ""}
              memoValue={memoDrafts[draftKey] || ""}
              saving={saving === `count-inline-${draftKey}`}
              disabled={schemaDisabled}
              onChange={(value) => onDraftChange(row, value)}
              onMemoChange={(value) => onMemoChange(row, value)}
              onSubmit={(value, memo) => onSubmitCount(row, value, memo)}
            />
          );
        })}
        {visibleRows.length === 0 ? (
          <div className="rounded-lg border py-8 text-center text-sm text-muted-foreground">{emptyLabel}</div>
        ) : null}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border sm:block">
        <Table className="min-w-[1220px] table-fixed">
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="w-[32%]">교재</TableHead>
              <TableHead className="w-24">위치</TableHead>
              <TableHead className="w-20 text-right">현재</TableHead>
              <TableHead className="w-36">실사</TableHead>
              <TableHead className="w-20 text-right">차이</TableHead>
              <TableHead className="w-24">상태</TableHead>
              <TableHead className="w-40">최종 실사</TableHead>
              <TableHead className="w-56">메모</TableHead>
              <TableHead className="w-24 text-right">작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupedRows.map((group) => {
              const isCollapsed = collapsedGroups.includes(group.label);
              const GroupIcon = isCollapsed ? ChevronRight : ChevronDown;
              const groupRecommendedCount = group.rows.filter((row) => row.isRecommended).length;
              const groupQualityIssueCount = group.rows.filter((row) => hasTextbookQualityIssue(row.source, duplicateTitleKeys)).length;
              return (
                <Fragment key={group.label}>
                  <TableRow>
                    <TableCell colSpan={9} className="bg-muted/40 p-0 text-xs font-semibold text-muted-foreground">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9 w-full justify-start rounded-none px-3 text-xs font-semibold text-muted-foreground hover:bg-muted"
                        aria-expanded={!isCollapsed}
                        aria-label={`${group.label} 그룹 ${isCollapsed ? "펼치기" : "접기"}`}
                        onClick={() => onToggleGroup?.(group.label)}
                      >
                        <GroupIcon className="mr-2 size-3.5" />
                        <span>{group.label} · {formatQuantity(group.rows.length)}종</span>
                        <span className="ml-auto flex items-center gap-2">
                          {groupRecommendedCount > 0 ? (
                            <Badge variant="outline" className="rounded-md border-blue-200 bg-blue-50 text-blue-700">
                              할 일 {formatQuantity(groupRecommendedCount)}
                            </Badge>
                          ) : null}
                          {groupQualityIssueCount > 0 ? (
                            <Badge variant="outline" className="rounded-md border-amber-200 bg-amber-50 text-amber-700">
                              정리 {formatQuantity(groupQualityIssueCount)}
                            </Badge>
                          ) : null}
                        </span>
                      </Button>
                    </TableCell>
                  </TableRow>
                  {isCollapsed ? null : group.rows.map((row) => {
                    const draftKey = getInventoryCountDraftKey(row.id, row.locationId);
                    const draftValue = countDrafts[draftKey] || "";
                    const memoValue = memoDrafts[draftKey] || "";
                    const difference = text(draftValue) ? numberValue(draftValue) - row.currentQuantity : 0;
                    const isSaving = saving === `count-inline-${draftKey}`;
                    return (
                      <TableRow key={draftKey}>
                        <TableCell className="min-w-0">
                          <div className="truncate font-medium">{row.title}</div>
                          <div className="truncate text-xs text-muted-foreground">{row.publisher}</div>
                        </TableCell>
                        <TableCell>{row.locationName}</TableCell>
                        <TableCell className="text-right font-mono">{formatQuantity(row.currentQuantity)}</TableCell>
                        <TableCell>
                          <Input
                            value={draftValue}
                            onChange={(event) => onDraftChange(row, event.target.value)}
                            inputMode="numeric"
                            aria-label={`${row.title} ${row.locationName} 실사 수량`}
                            placeholder={`${formatQuantity(row.currentQuantity)}`}
                            className="h-9 text-right font-mono"
                          />
                        </TableCell>
                        <TableCell className={cn("text-right font-mono", difference < 0 && "text-red-600", difference > 0 && "text-emerald-700")}>
                          {text(draftValue) ? `${difference > 0 ? "+" : ""}${formatQuantity(difference)}` : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("rounded-md", getInventoryCountStatusClassName(row))}>
                            {inventoryAuditFilterLabels[row.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <div>{row.latestCountAt ? formatCompactDateTime(row.latestCountAt) : "실사 없음"}</div>
                          <div>{row.reason}</div>
                          {row.dueLabel !== row.reason ? <div>{row.dueLabel}</div> : null}
                        </TableCell>
                        <TableCell>
                          <Input
                            value={memoValue}
                            onChange={(event) => onMemoChange(row, event.target.value)}
                            aria-label={`${row.title} ${row.locationName} 실사 메모`}
                            placeholder="메모"
                            className="h-9"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            size="sm"
                            disabled={schemaDisabled || isSaving || !text(draftValue)}
                            onClick={() => onSubmitCount(row, draftValue, memoValue)}
                          >
                            <PackageCheck className="mr-2 size-3.5" />
                            반영
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </Fragment>
              );
            })}
            {visibleRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-28 text-center text-muted-foreground">
                  {emptyLabel}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function InventoryCountMobileCard({
  row,
  value,
  memoValue,
  saving,
  disabled,
  onChange,
  onMemoChange,
  onSubmit,
}: {
  row: InventoryCountRow;
  value: string;
  memoValue: string;
  saving: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onMemoChange: (value: string) => void;
  onSubmit: (value: string, memo: string) => void;
}) {
  const difference = text(value) ? numberValue(value) - row.currentQuantity : 0;

  return (
    <form
      className="rounded-lg border bg-background p-3 shadow-sm active:scale-[0.99]"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value, memoValue);
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{row.title}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{row.publisher}</div>
        </div>
        <Badge variant="outline" className={cn("shrink-0 rounded-md", getInventoryCountStatusClassName(row))}>
          {inventoryAuditFilterLabels[row.status]}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-md bg-muted/50 px-2 py-2">
          <div className="text-muted-foreground">위치</div>
          <div className="mt-1 font-medium">{row.locationName}</div>
        </div>
        <div className="rounded-md bg-muted/50 px-2 py-2">
          <div className="text-muted-foreground">현재</div>
          <div className="mt-1 font-mono font-semibold">{formatQuantity(row.currentQuantity)}</div>
        </div>
        <div className="rounded-md bg-muted/50 px-2 py-2">
          <div className="text-muted-foreground">차이</div>
          <div className={cn("mt-1 font-mono font-semibold", difference < 0 && "text-red-600", difference > 0 && "text-emerald-700")}>
            {text(value) ? `${difference > 0 ? "+" : ""}${formatQuantity(difference)}` : "-"}
          </div>
        </div>
      </div>
      <Input
        value={memoValue}
        onChange={(event) => onMemoChange(event.target.value)}
        aria-label={`${row.title} ${row.locationName} 실사 메모`}
        placeholder="메모"
        className="mt-3 h-11"
      />
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_88px] gap-2">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="numeric"
          aria-label={`${row.title} ${row.locationName} 실사 수량`}
          placeholder={`${formatQuantity(row.currentQuantity)}`}
          className="h-12 text-right font-mono text-base"
        />
        <Button type="submit" className="h-12" disabled={disabled || saving || !text(value)}>
          반영
        </Button>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {row.latestCountAt
          ? `최종 ${formatCompactDateTime(row.latestCountAt)} · ${row.reason}${row.dueLabel !== row.reason ? ` · ${row.dueLabel}` : ""}`
          : row.reason}
      </div>
    </form>
  );
}

function TextbookTable({
  rows,
  locations,
  onSelectTextbook,
  amountMode = "stockValue",
  duplicateTitleKeys = new Set<string>(),
  collapsedGroups = [],
  onToggleGroup,
  selectedIds = [],
  allVisibleSelected = false,
  someVisibleSelected = false,
  onToggleAllVisible,
  onBulkSelectionChange,
  emptyLabel = "교재가 없습니다",
}: {
  rows: Row[];
  locations: Row[];
  onSelectTextbook?: (row: Row) => void;
  amountMode?: TextbookAmountMode;
  duplicateTitleKeys?: Set<string>;
  collapsedGroups?: string[];
  onToggleGroup?: (label: string) => void;
  selectedIds?: string[];
  allVisibleSelected?: boolean;
  someVisibleSelected?: boolean;
  onToggleAllVisible?: (checked: boolean) => void;
  onBulkSelectionChange?: (id: string, checked: boolean) => void;
  emptyLabel?: string;
}) {
  const groupedRows = rows.reduce<Array<{ label: string; rows: Row[] }>>((groups, row) => {
    const label = getTextbookGroupLabel(row);
    const group = groups.find((item) => item.label === label);
    if (group) {
      group.rows.push(row);
      return groups;
    }
    groups.push({ label, rows: [row] });
    return groups;
  }, []);
  const sortedGroupedRows = [...groupedRows]
    .sort((left, right) => compareTextbookGroupLabels(left.label, right.label))
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort((left, right) => {
        const leftScore = getTextbookQualityScore(left, duplicateTitleKeys);
        const rightScore = getTextbookQualityScore(right, duplicateTitleKeys);
        if (leftScore !== rightScore) return rightScore - leftScore;
        return getTextbookTitle(left).localeCompare(getTextbookTitle(right), "ko", { numeric: true });
      }),
    }));
  const amountHeader = amountMode === "salePrice" ? "판매가" : "재고금액";
  const hasSelection = Boolean(onBulkSelectionChange);
  const columnSpan = locations.length + 7 + (onSelectTextbook ? 1 : 0) + (hasSelection ? 1 : 0);
  const tableTotals = {
    totalQuantity: rows.reduce((sum, row) => sum + numberValue(row.totalQuantity), 0),
    amountValue: rows.reduce((sum, row) => sum + numberValue(amountMode === "salePrice" ? getTextbookSalePrice(row) : row.stockValue), 0),
    locationQuantities: Object.fromEntries(
      locations.map((location) => {
        const locationId = getRecordId(location);
        const quantity = rows.reduce((sum, row) => {
          const locationQuantities = (row.locationQuantities || {}) as Record<string, unknown>;
          return sum + numberValue(locationQuantities[locationId]);
        }, 0);
        return [locationId, quantity];
      }),
    ) as Record<string, number>,
  };

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="min-w-[1120px] table-fixed">
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            {hasSelection ? (
              <TableHead className="w-10">
                <Checkbox
                  checked={allVisibleSelected || (someVisibleSelected && "indeterminate")}
                  onCheckedChange={(value) => onToggleAllVisible?.(!!value)}
                  aria-label="현재 교재 전체 선택"
                />
              </TableHead>
            ) : null}
            <TableHead className="w-[30%] min-w-72">교재</TableHead>
            <TableHead className="w-20">과목</TableHead>
            <TableHead className="w-20">학년</TableHead>
            <TableHead className="w-28">세부과목</TableHead>
            <TableHead className="w-32">ISBN</TableHead>
            {locations.map((location) => (
              <TableHead key={getRecordId(location)} className="w-20 text-right">{text(location.name || location.code)}</TableHead>
            ))}
            <TableHead className="w-20 text-right">합계</TableHead>
            <TableHead className="w-24 text-right">{amountHeader}</TableHead>
            {onSelectTextbook ? <TableHead className="w-20 text-right">관리</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedGroupedRows.map((group) => (
            <Fragment key={group.label}>
              {(() => {
                const isCollapsed = collapsedGroups.includes(group.label);
                const GroupIcon = isCollapsed ? ChevronRight : ChevronDown;
                const groupTotalQuantity = group.rows.reduce((sum, row) => sum + numberValue(row.totalQuantity), 0);
                const groupAmountValue = group.rows.reduce(
                  (sum, row) => sum + numberValue(amountMode === "salePrice" ? getTextbookSalePrice(row) : row.stockValue),
                  0,
                );
                const groupQualityIssueCount = group.rows.filter((row) => hasTextbookQualityIssue(row, duplicateTitleKeys)).length;

                return (
                  <>
                    <TableRow>
                      <TableCell colSpan={columnSpan} className="bg-muted/40 p-0 text-xs font-semibold text-muted-foreground">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 w-full justify-start rounded-none px-3 text-xs font-semibold text-muted-foreground hover:bg-muted"
                          aria-expanded={!isCollapsed}
                          aria-label={`${group.label} 그룹 ${isCollapsed ? "펼치기" : "접기"}`}
                          onClick={() => onToggleGroup?.(group.label)}
                        >
                          <GroupIcon className="mr-2 size-3.5" />
                          <span>{group.label} · {formatQuantity(group.rows.length)}종</span>
                          <span className="ml-auto flex items-center gap-2">
                            {groupQualityIssueCount > 0 ? (
                              <Badge variant="outline" className="rounded-md border-amber-200 bg-amber-50 text-amber-700">
                                정리 필요 {formatQuantity(groupQualityIssueCount)}
                              </Badge>
                            ) : null}
                            <Badge variant="outline" className="rounded-md bg-background">
                              재고 {formatQuantity(groupTotalQuantity)}권
                            </Badge>
                            <Badge variant="outline" className="hidden rounded-md bg-background sm:inline-flex">
                              {amountMode === "salePrice" ? "판매가합" : "재고금액"} {formatCurrency(groupAmountValue)}
                            </Badge>
                          </span>
                        </Button>
                      </TableCell>
                    </TableRow>
                    {isCollapsed ? null : group.rows.map((row) => {
                const rowId = getRecordId(row);
                const totalQuantity = numberValue(row.totalQuantity);
                const locationQuantities = (row.locationQuantities || {}) as Record<string, unknown>;
                const amountValue = amountMode === "salePrice" ? getTextbookSalePrice(row) : row.stockValue;
                const gradeLabel = getTextbookGradeLabel(getTextbookGradeLevel(row)) || getTextbookSchoolLevelLabel(getTextbookSchoolLevel(row)) || "-";
                const subSubjectLabel = getTextbookSubSubject(row) || "-";
                const qualityIssues = getTextbookQualityIssues(row, duplicateTitleKeys);
                const qualityIssueLabels = getTextbookQualityIssueLabels(qualityIssues);
                const primaryQualityIssue = qualityIssueLabels[0];
                const extraQualityIssueCount = Math.max(0, qualityIssueLabels.length - 1);
                return (
                  <TableRow key={rowId} className={cn(qualityIssues.inactive && "bg-muted/20 text-muted-foreground")}>
                    {hasSelection ? (
                      <TableCell className="w-10">
                        <Checkbox
                          checked={selectedIds.includes(rowId)}
                          onCheckedChange={(value) => onBulkSelectionChange?.(rowId, !!value)}
                          aria-label={`${getTextbookTitle(row)} ${getPublisherLabel(row)} ${rowId} 선택`}
                        />
                      </TableCell>
                    ) : null}
                    <TableCell className="min-w-0">
                      {onSelectTextbook ? (
                        <button
                          type="button"
                          aria-label={`${getTextbookTitle(row)} ${getPublisherLabel(row)} ${rowId} 열기`}
                          className="block max-w-full truncate text-left font-medium hover:underline"
                          onClick={() => onSelectTextbook(row)}
                        >
                          {getTextbookTitle(row)}
                        </button>
                      ) : (
                        <div className="font-medium">{getTextbookTitle(row)}</div>
                      )}
                      <div className="text-xs text-muted-foreground">{getPublisherLabel(row)}</div>
                      {primaryQualityIssue ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge
                            variant={primaryQualityIssue.tone === "default" ? "secondary" : "outline"}
                            className={cn(
                              "h-5 rounded px-1.5 text-[11px]",
                              primaryQualityIssue.tone === "danger" && "text-red-700",
                              primaryQualityIssue.tone === "warning" && "text-amber-700",
                              primaryQualityIssue.tone === "muted" && "text-zinc-600",
                            )}
                            title={qualityIssueLabels.map((issue) => issue.label).join(", ")}
                            aria-label={`정리 필요: ${qualityIssueLabels.map((issue) => issue.label).join(", ")}`}
                          >
                            {primaryQualityIssue.label}
                            {extraQualityIssueCount > 0 ? ` +${extraQualityIssueCount}` : ""}
                          </Badge>
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{getSubjectLabel(row.subject)}</TableCell>
                    <TableCell className="whitespace-nowrap">{gradeLabel}</TableCell>
                    <TableCell className="max-w-[112px] truncate">{subSubjectLabel}</TableCell>
                    <TableCell className="truncate font-mono text-xs">{text(row.isbn13 || row.barcode) || "-"}</TableCell>
                    {locations.map((location) => (
                      <TableCell key={getRecordId(location)} className="text-right">
                        {formatQuantity(locationQuantities[getRecordId(location)])}
                      </TableCell>
                    ))}
                    <TableCell className="text-right">
                      <Badge variant="outline" className={cn("rounded-md", inventoryTone(totalQuantity))}>
                        {formatQuantity(totalQuantity)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(amountValue)}</TableCell>
                    {onSelectTextbook ? (
                      <TableCell className="text-right">
                        <Button type="button" variant="ghost" size="sm" aria-label={`${getTextbookTitle(row)} ${getPublisherLabel(row)} ${rowId} 편집`} onClick={() => onSelectTextbook(row)}>
                          <Pencil className="mr-2 size-3.5" />
                          편집
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
                    })}
                  </>
                );
              })()}
            </Fragment>
          ))}
          {rows.length > 0 ? (
            <TableRow className="bg-muted/30 text-xs font-semibold text-muted-foreground">
              {hasSelection ? <TableCell /> : null}
              <TableCell>합계</TableCell>
              <TableCell />
              <TableCell />
              <TableCell />
              <TableCell />
              {locations.map((location) => (
                <TableCell key={getRecordId(location)} className="text-right">
                  {formatQuantity(tableTotals.locationQuantities[getRecordId(location)])}
                </TableCell>
              ))}
              <TableCell className="text-right">{formatQuantity(tableTotals.totalQuantity)}</TableCell>
              <TableCell className="text-right">{formatCurrency(tableTotals.amountValue)}</TableCell>
              {onSelectTextbook ? <TableCell /> : null}
            </TableRow>
          ) : null}
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnSpan} className="h-28 text-center text-muted-foreground">
                {emptyLabel}
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}

const stockMoveTypeLabels: Record<string, string> = {
  opening: "기초",
  purchase_receipt: "입고",
  sale_issue: "출고",
  return_in: "반품 입고",
  return_out: "반품 출고",
  transfer_in: "이동 입고",
  transfer_out: "이동 출고",
  stock_adjustment: "실사 조정",
};

function getInventoryAuditActor(row: Row, currentUserId: string, currentUserLabel: string) {
  const actorLabel = text(
    row.created_by_email ||
      row.createdByEmail ||
      row.created_by_name ||
      row.createdByName ||
      row.actor ||
      row.actor_name ||
      row.actorName,
  );
  if (actorLabel) return actorLabel;

  const actorId = text(row.created_by || row.createdBy || row.updated_by || row.updatedBy);
  if (actorId && actorId === currentUserId && currentUserLabel) return currentUserLabel;
  return actorId || "-";
}

function InventoryHistoryPanel({
  stockMoves,
  stockCounts,
  textbooks,
  locations,
  currentUserId,
  currentUserLabel,
}: {
  stockMoves: Row[];
  stockCounts: Row[];
  textbooks: Row[];
  locations: Row[];
  currentUserId: string;
  currentUserLabel: string;
}) {
  const rows = useMemo(() => {
    const moveRows = stockMoves.map((move) => {
      const quantity = numberValue(move.quantity);
      const textbook = getTextbookById(textbooks, text(move.textbook_id || move.textbookId));
      const type = text(move.move_type || move.moveType);
      return {
        id: `move-${getRecordId(move)}`,
        at: text(move.moved_at || move.movedAt || move.created_at || move.createdAt),
        textbookTitle: getTextbookTitle(textbook || {}) || "-",
        locationName: getLocationName(locations, text(move.location_id || move.locationId)) || "-",
        change: `${quantity > 0 ? "+" : ""}${formatQuantity(quantity)}권`,
        action: stockMoveTypeLabels[type] || type || "재고 변경",
        actor: getInventoryAuditActor(move, currentUserId, currentUserLabel),
        memo: text(move.memo),
      };
    });
    const countRows = stockCounts.map((count) => {
      const expected = numberValue(count.expected_quantity || count.expectedQuantity);
      const counted = numberValue(count.counted_quantity || count.countedQuantity);
      const difference = counted - expected;
      const textbook = getTextbookById(textbooks, text(count.textbook_id || count.textbookId));
      return {
        id: `count-${getRecordId(count)}`,
        at: text(count.counted_at || count.countedAt || count.created_at || count.createdAt),
        textbookTitle: getTextbookTitle(textbook || {}) || "-",
        locationName: getLocationName(locations, text(count.location_id || count.locationId)) || "-",
        change: `${difference > 0 ? "+" : ""}${formatQuantity(difference)}권`,
        action: `실사 ${formatQuantity(expected)}→${formatQuantity(counted)}`,
        actor: getInventoryAuditActor(count, currentUserId, currentUserLabel),
        memo: text(count.memo),
      };
    });

    return [...moveRows, ...countRows]
      .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
      .slice(0, 30);
  }, [currentUserId, currentUserLabel, locations, stockCounts, stockMoves, textbooks]);

  return (
    <section className="overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h3 className="text-sm font-semibold">재고 이력</h3>
        <Badge variant="secondary" className="rounded-md">최근 {formatQuantity(rows.length)}건</Badge>
      </div>
      <div className="overflow-x-auto">
        <Table className="min-w-[920px]">
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="w-[120px]">일시</TableHead>
              <TableHead>교재</TableHead>
              <TableHead className="w-[96px]">위치</TableHead>
              <TableHead className="w-[88px] text-right">변경</TableHead>
              <TableHead className="w-[140px]">작업</TableHead>
              <TableHead className="w-[160px]">실행자</TableHead>
              <TableHead className="w-[220px]">메모</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-muted-foreground">{formatCompactDateTime(row.at)}</TableCell>
                <TableCell className="max-w-[320px] truncate font-medium">{row.textbookTitle}</TableCell>
                <TableCell className="truncate">{row.locationName}</TableCell>
                <TableCell className="text-right font-medium">{row.change}</TableCell>
                <TableCell>{row.action}</TableCell>
                <TableCell className="max-w-[160px] truncate">{row.actor}</TableCell>
                <TableCell className="max-w-[220px] truncate text-muted-foreground">{row.memo || "-"}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-20 text-center text-muted-foreground">
                  재고 이력이 없습니다
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function getPurchaseProcessEmptyLabel(
  mode: "request" | "order",
  groupId: string,
  requestFilter: PurchaseRequestFilter,
  orderFilter: PurchaseOrderFilter,
  searchQuery = "",
) {
  if (text(searchQuery)) {
    return mode === "request" ? "검색 조건에 맞는 요청이 없습니다" : "검색 조건에 맞는 주문·입고 건이 없습니다";
  }
  if (mode === "request" && requestFilter === "unregistered") {
    return "미등록 요청이 없습니다";
  }
  if (mode === "request" && requestFilter === "orderable") {
    return "주문 가능한 요청이 없습니다";
  }
  if (mode === "request") {
    return "대기 중인 요청이 없습니다";
  }
  if (orderFilter === "waiting") {
    return "입고 대기 건이 없습니다";
  }
  if (orderFilter === "partial") {
    return "부분입고 건이 없습니다";
  }
  if (groupId === "ordered") {
    return "입고 대기 주문이 없습니다";
  }
  if (groupId === "partially_received") {
    return "부분입고 건이 없습니다";
  }
  return "입고 완료 건이 없습니다";
}

function getSalesProcessEmptyLabel(groupId: string, statusFilter: SalesProcessFilter, searchQuery = "") {
  if (text(searchQuery)) {
    return "검색 조건에 맞는 출고 건이 없습니다";
  }
  if (statusFilter === "waiting") {
    return "출고 대기 건이 없습니다";
  }
  if (statusFilter === "issued") {
    return "출고 완료 건이 없습니다";
  }
  if (groupId === "charged") {
    return "출고 대기 건이 없습니다";
  }
  if (groupId === "issued") {
    return "출고 완료 건이 없습니다";
  }
  if (groupId === "cancelled") {
    return "취소 건이 없습니다";
  }
  return "반품 건이 없습니다";
}

function ProcessGroupEmptyState({ label, actionLabel, onAction }: { label: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="grid justify-items-center gap-3 border-t bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
      <span>{label}</span>
      {actionLabel && onAction ? (
        <Button type="button" size="sm" variant="outline" className="h-8 rounded-md bg-background" onClick={onAction}>
          <Plus className="mr-2 size-3.5" />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function PurchaseProcessTable({
  mode,
  orders,
  lines,
  textbooks,
  locations,
  suppliers,
  publisherSupplierLinks,
  classes,
  students,
  selectedLineId,
  selectedLineIds = [],
  boardScope,
  requestFilter,
  orderFilter,
  searchQuery,
  saving,
  onAddLine,
  onSelectLine,
  onRegisterTextbook,
  onToggleLine,
  onToggleVisibleLines,
  onBulkOrder,
  onScopeChange,
  onRequestFilterChange,
  onOrderFilterChange,
  onMoveLine,
  onDeleteLine,
}: {
  mode: "request" | "order";
  orders: Row[];
  lines: Row[];
  textbooks: Row[];
  locations: Row[];
  suppliers: Row[];
  publisherSupplierLinks: Row[];
  classes: Row[];
  students: Row[];
  selectedLineId: string;
  selectedLineIds?: string[];
  boardScope: PurchaseBoardScope;
  requestFilter: PurchaseRequestFilter;
  orderFilter: PurchaseOrderFilter;
  searchQuery: string;
  saving: string;
  onAddLine: () => void;
  onSelectLine: (line: Row, order: Row | undefined, stageOverride?: string) => void;
  onRegisterTextbook: (line: Row, order: Row | undefined) => void;
  onToggleLine?: (lineId: string, checked: boolean) => void;
  onToggleVisibleLines?: (lineIds: string[], checked: boolean) => void;
  onBulkOrder?: () => void;
  onScopeChange: (scope: PurchaseBoardScope) => void;
  onRequestFilterChange: (filter: PurchaseRequestFilter) => void;
  onOrderFilterChange: (filter: PurchaseOrderFilter) => void;
  onMoveLine: (line: Row, order: Row | undefined, status: PurchaseKanbanStatus, draft?: PurchaseKanbanDraft) => void;
  onDeleteLine: (line: Row, order: Row | undefined) => void;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const grouped = groupPurchaseLinesByStatus({ orders, lines }) as Record<string, Row[]>;
  const ordersById = new Map(orders.map((order) => [getRecordId(order), order]));
  const requestFilterOptions = [
    { value: "all", label: "전체 요청" },
    { value: "unregistered", label: "미등록" },
    { value: "orderable", label: "주문 가능" },
  ] satisfies Array<{ value: PurchaseRequestFilter; label: string }>;
  const groups = mode === "request"
    ? [{ id: "requested", title: "요청대기" }]
    : [
        { id: "ordered", title: "주문완료" },
        { id: "partially_received", title: "부분입고" },
        { id: "received", title: "입고완료" },
      ] as const;
  const visibleGroups = mode === "request"
    ? groups
    : orderFilter === "waiting"
      ? groups.filter((group) => group.id === "ordered" || group.id === "partially_received")
      : orderFilter === "partial"
        ? groups.filter((group) => group.id === "partially_received")
        : groups;

  function toggleGroup(id: string) {
    setCollapsedGroups((current) => ({ ...current, [id]: !current[id] }));
  }

  function collapseAllGroups() {
    setCollapsedGroups(Object.fromEntries(visibleGroups.map((group) => [group.id, true])));
  }

  function expandAllGroups() {
    setCollapsedGroups({});
  }

  function shouldShowRequestLineForFilter(line: Row, filter: PurchaseRequestFilter) {
    if (mode !== "request" || filter === "all") {
      return true;
    }
    const order = ((line.order || getPurchaseLineOrder(line, ordersById)) || {}) as Row;
    const draft = buildPurchaseCardDraft(line, order);
    const textbook = getTextbookById(textbooks, draft.textbookId || draft.requestedTextbookTitle);
    if (filter === "unregistered") {
      return !textbook;
    }
    return Boolean(textbook);
  }

  function shouldShowOrderGroupForFilter(groupId: string, filter: PurchaseOrderFilter) {
    if (mode === "request") return true;
    if (filter === "waiting") return groupId === "ordered" || groupId === "partially_received";
    if (filter === "partial") return groupId === "partially_received";
    return true;
  }

  function getVisiblePurchaseRows(groupId: string, nextRequestFilter = requestFilter, nextBoardScope = boardScope) {
    return (grouped[groupId] || [])
      .filter((line) => shouldShowPurchaseLineOnBoard(line, nextBoardScope))
      .filter((line) => shouldShowRequestLineForFilter(line, nextRequestFilter))
      .filter((line) => {
        const order = ((line.order || getPurchaseLineOrder(line, ordersById)) || {}) as Row;
        return matchesPurchaseLineQuery({
          line,
          order,
          query: searchQuery,
          textbooks,
          classes,
          suppliers,
          publisherSupplierLinks,
          locations,
        });
      });
  }

  const visibleRowCount = visibleGroups.reduce((sum, group) => sum + getVisiblePurchaseRows(group.id).length, 0);
  const visibleRequestedTotal = visibleGroups.reduce(
    (sum, group) => sum + getVisiblePurchaseRows(group.id).reduce((groupSum, line) => groupSum + numberValue(line.requested_quantity || line.requestedQuantity), 0),
    0,
  );
  const visibleOrderedTotal = visibleGroups.reduce(
    (sum, group) => sum + getVisiblePurchaseRows(group.id).reduce((groupSum, line) => groupSum + numberValue(line.ordered_quantity || line.orderedQuantity), 0),
    0,
  );
  const visibleReceivedTotal = visibleGroups.reduce(
    (sum, group) => sum + getVisiblePurchaseRows(group.id).reduce((groupSum, line) => groupSum + numberValue(line.received_quantity || line.receivedQuantity), 0),
    0,
  );
  const renderedGroups = visibleGroups.filter((group) => getVisiblePurchaseRows(group.id).length > 0);
  const emptyGroupId = visibleGroups[0]?.id || (mode === "request" ? "requested" : "ordered");
  const getRequestFilterCount = (filter: PurchaseRequestFilter) =>
    groups.reduce((sum, group) => sum + getVisiblePurchaseRows(group.id, filter).length, 0);
  const getOrderFilterCount = (filter: PurchaseOrderFilter) =>
    groups
      .filter((group) => shouldShowOrderGroupForFilter(group.id, filter))
      .reduce((sum, group) => sum + getVisiblePurchaseRows(group.id).length, 0);
  const getBoardScopeCount = (scope: PurchaseBoardScope) =>
    groups.reduce((sum, group) => sum + getVisiblePurchaseRows(group.id, requestFilter, scope).length, 0);
  const visibleOrderableRequestLineIds = mode === "request"
    ? visibleGroups.flatMap((group) =>
        getVisiblePurchaseRows(group.id)
          .filter((line) => isOrderablePurchaseRequestLine(line, getPurchaseLineOrder(line, ordersById), textbooks))
          .map(getRecordId)
          .filter(Boolean),
      )
    : [];
  const selectedOrderableRequestCount = visibleOrderableRequestLineIds.filter((id) => selectedLineIds.includes(id)).length;
  const allVisibleOrderableRequestsSelected =
    visibleOrderableRequestLineIds.length > 0 &&
    selectedOrderableRequestCount === visibleOrderableRequestLineIds.length;
  const someVisibleOrderableRequestsSelected =
    selectedOrderableRequestCount > 0 && !allVisibleOrderableRequestsSelected;

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-background">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b p-3">
        <div className="flex flex-wrap gap-1">
          {mode === "order" ? (
            <>
              {(Object.keys(purchaseBoardScopeLabels) as PurchaseBoardScope[]).map((scope) => (
                <Button
                  key={scope}
                  type="button"
                  variant={boardScope === scope ? "default" : "outline"}
                  size="sm"
                  className="h-8 rounded-md"
                  aria-pressed={boardScope === scope}
                  onClick={() => onScopeChange(scope)}
                >
                  <span>{purchaseBoardScopeLabels[scope]}</span>
                  <span className={cn(
                    "ml-2 rounded px-1.5 text-[11px] font-semibold",
                    boardScope === scope ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
                  )}>
                    {formatQuantity(getBoardScopeCount(scope))}
                  </span>
                </Button>
              ))}
              <span className="mx-1 h-5 w-px self-center bg-border" />
              {(Object.keys(purchaseOrderFilterLabels) as PurchaseOrderFilter[]).map((filter) => (
                <Button
                  key={filter}
                  type="button"
                  variant={orderFilter === filter ? "default" : "outline"}
                  size="sm"
                  className="h-8 rounded-md"
                  aria-pressed={orderFilter === filter}
                  onClick={() => onOrderFilterChange(filter)}
                >
                  <span>{purchaseOrderFilterLabels[filter]}</span>
                  <span className={cn(
                    "ml-2 rounded px-1.5 text-[11px] font-semibold",
                    orderFilter === filter ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
                  )}>
                    {formatQuantity(getOrderFilterCount(filter))}
                  </span>
                </Button>
              ))}
            </>
          ) : (
            requestFilterOptions.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={requestFilter === option.value ? "default" : "outline"}
                size="sm"
                className="h-8 rounded-md"
                aria-pressed={requestFilter === option.value}
                onClick={() => onRequestFilterChange(option.value)}
              >
                <span>{option.label}</span>
                <span className={cn(
                  "ml-2 rounded px-1.5 text-[11px] font-semibold",
                  requestFilter === option.value ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
                )}>
                  {formatQuantity(getRequestFilterCount(option.value))}
                </span>
              </Button>
            ))
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Badge variant="secondary" className="h-8 rounded-md px-2">
            표시 {formatQuantity(visibleRowCount)}건
          </Badge>
          <Badge variant="outline" className="h-8 rounded-md px-2">
            요청 {formatQuantity(visibleRequestedTotal)}
          </Badge>
          {mode === "order" ? (
            <>
              <Badge variant="outline" className="h-8 rounded-md px-2">
                주문 {formatQuantity(visibleOrderedTotal)}
              </Badge>
              <Badge variant="outline" className="h-8 rounded-md px-2">
                입고 {formatQuantity(visibleReceivedTotal)}
              </Badge>
            </>
          ) : null}
          {mode === "request" && selectedOrderableRequestCount > 0 ? (
            <>
              <Badge variant="secondary" className="h-8 rounded-md px-2">
                선택 {formatQuantity(selectedOrderableRequestCount)}
              </Badge>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0"
                disabled={selectedOrderableRequestCount === 0}
                onClick={onBulkOrder}
              >
                선택 주문
              </Button>
            </>
          ) : null}
          {visibleRowCount > 0 ? (
            <>
              <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={collapseAllGroups}>
                전체 접기
              </Button>
              <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={expandAllGroups}>
                전체 펼치기
              </Button>
            </>
          ) : null}
          {visibleRowCount > 0 ? (
            mode === "request" ? (
              <Button type="button" size="sm" className="shrink-0" onClick={onAddLine}>
                <Plus className="mr-2 size-4" />
                요청 추가
              </Button>
            ) : (
              <Button type="button" size="sm" className="shrink-0" onClick={onAddLine}>
                <Plus className="mr-2 size-4" />
                주문 추가
              </Button>
            )
          ) : null}
        </div>
      </div>

      {visibleRowCount === 0 ? (
        <ProcessGroupEmptyState
          label={getPurchaseProcessEmptyLabel(mode, emptyGroupId, requestFilter, orderFilter, searchQuery)}
          actionLabel={mode === "request" ? "요청 바로 추가" : "주문 바로 추가"}
          onAction={onAddLine}
        />
      ) : (
        <div className="grid gap-0">
          {renderedGroups.map((group) => {
          const rows = getVisiblePurchaseRows(group.id);
          const collapsed = Boolean(collapsedGroups[group.id]);
          const requestedTotal = rows.reduce((sum, line) => sum + numberValue(line.requested_quantity || line.requestedQuantity), 0);
          const orderedTotal = rows.reduce((sum, line) => sum + numberValue(line.ordered_quantity || line.orderedQuantity), 0);
          const receivedTotal = rows.reduce((sum, line) => sum + numberValue(line.received_quantity || line.receivedQuantity), 0);

          return (
            <section key={group.id} className="border-b last:border-b-0">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-3 text-left text-sm font-medium hover:bg-muted/60"
                aria-expanded={!collapsed}
                aria-label={`${group.title} 그룹 ${collapsed ? "펼치기" : "접기"}`}
                onClick={() => toggleGroup(group.id)}
              >
                {collapsed ? <ChevronRight className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                <span className={cn("size-2 rounded-full", processStatusDotClass(group.id))} />
                <span>{group.title}</span>
                <Badge variant="secondary" className="rounded-md">{formatQuantity(rows.length)}</Badge>
                <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="rounded-md bg-background">요청 {formatQuantity(requestedTotal)}</Badge>
                  {mode === "order" ? (
                    <>
                      <Badge variant="outline" className="rounded-md bg-background">주문 {formatQuantity(orderedTotal)}</Badge>
                      <Badge variant="outline" className="rounded-md bg-background">입고 {formatQuantity(receivedTotal)}</Badge>
                    </>
                  ) : null}
                </span>
              </button>
              {!collapsed && rows.length > 0 ? (
                <div className="max-w-full overflow-x-auto">
                  <Table className={mode === "request" ? "w-full min-w-[1100px]" : "w-full min-w-[1160px]"}>
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow className="bg-muted/30">
                        {mode === "request" ? (
                          <TableHead className="w-10">
                            <Checkbox
                              checked={allVisibleOrderableRequestsSelected || (someVisibleOrderableRequestsSelected && "indeterminate")}
                              onCheckedChange={(value) => onToggleVisibleLines?.(visibleOrderableRequestLineIds, value === true)}
                              aria-label="주문 가능한 요청 전체 선택"
                            />
                          </TableHead>
                        ) : null}
                        <TableHead className="w-[104px]">진행상태</TableHead>
                        {mode === "order" ? (
                          <>
                            <TableHead className="w-[120px]">총판</TableHead>
                            <TableHead className="w-[96px] text-right">단가</TableHead>
                          </>
                        ) : null}
                        <TableHead className="w-[118px]">처리일시</TableHead>
                        <TableHead className="w-[104px]">요청자</TableHead>
                        <TableHead>교재명</TableHead>
                        <TableHead className="w-[88px]">위치</TableHead>
                        <TableHead className="w-[140px]">수업</TableHead>
                        <TableHead className="w-[72px] text-right">요청</TableHead>
                        {mode === "order" ? (
                          <>
                            <TableHead className="w-[72px] text-right">주문</TableHead>
                            <TableHead className="w-[72px] text-right">입고</TableHead>
                          </>
                        ) : null}
                        <TableHead className="w-[96px]">판단</TableHead>
                        <TableHead className={mode === "request" ? "w-[280px] text-right" : "w-[160px] text-right"}>작업</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((line) => {
                        const order = ((line.order || getPurchaseLineOrder(line, ordersById)) || {}) as Row;
                        const lineId = getRecordId(line);
                        const draft = buildPurchaseCardDraft(line, order);
                        const status = ((text(line.status || order.status) || group.id) as PurchaseKanbanStatus);
                        const textbook = getTextbookById(textbooks, draft.textbookId || draft.requestedTextbookTitle);
                        const textbookTitle = getPurchaseTextbookTitle(line, textbook);
                        const configuredSupplierId = getConfiguredSupplierIdForTextbook(textbook, publisherSupplierLinks) || draft.supplierId;
                        const unitCost = getTextbookSalePrice(textbook || {}) || numberValue(draft.unitCost);
                        const locationName = getLocationName(locations, draft.locationId) || "-";
                        const classRecord = getClassById(classes, draft.classId);
                        const classStudentCount = getClassStudentCount(classRecord, students);
                        const quantityFit = getPurchaseQuantityClassFit(draft.requestedQuantity, classStudentCount);
                        const requested = numberValue(draft.requestedQuantity);
                        const ordered = numberValue(draft.orderedQuantity);
                        const received = numberValue(draft.receivedQuantity);
                        const nextStatus = purchaseNextStatus(status);
                        const processAction = purchaseProcessAction(status);
                        const isOrderableRequest = mode === "request" && Boolean(textbook);

                        return (
                          <TableRow key={lineId} className={cn(selectedLineId === lineId && "bg-primary/5")}>
                            {mode === "request" ? (
                              <TableCell>
                                <Checkbox
                                  checked={selectedLineIds.includes(lineId)}
                                  disabled={!isOrderableRequest}
                                  onCheckedChange={(value) => onToggleLine?.(lineId, value === true)}
                                  aria-label={`${textbookTitle} 주문 선택`}
                                />
                              </TableCell>
                            ) : null}
                            <TableCell>
                              <Badge variant="outline" className={cn("rounded-md", processStatusPillClass(status))}>
                                {purchaseStatusLabel(status, ordered, received)}
                              </Badge>
                            </TableCell>
                            {mode === "order" ? (
                              <>
                                <TableCell className="max-w-[120px] truncate">{getSupplierName(suppliers, configuredSupplierId) || "-"}</TableCell>
                                <TableCell className="text-right">{unitCost > 0 ? formatCurrency(unitCost) : "-"}</TableCell>
                              </>
                            ) : null}
                            <TableCell className="text-muted-foreground">{formatCompactDateTime(getPurchaseEventAt(line, order, status))}</TableCell>
                            <TableCell className="max-w-[104px] truncate">{draft.requestBy || "-"}</TableCell>
                            <TableCell>
                              <button
                                type="button"
                                onClick={() => onSelectLine(line, order)}
                                className="max-w-[360px] truncate text-left font-medium hover:underline"
                              >
                                {textbookTitle}
                              </button>
                              {mode === "request" && !textbook ? (
                                <div className="text-xs text-amber-700">미등록</div>
                              ) : null}
                            </TableCell>
                            <TableCell className="max-w-[88px] truncate">{locationName}</TableCell>
                            <TableCell className="max-w-[140px] truncate">{classRecord ? getClassName(classRecord) : "수업 미지정"}</TableCell>
                            <TableCell className="text-right">{formatQuantity(requested)}</TableCell>
                            {mode === "order" ? (
                              <>
                                <TableCell className="text-right">{formatQuantity(ordered)}</TableCell>
                                <TableCell className="text-right">{formatQuantity(received)}</TableCell>
                              </>
                            ) : null}
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "rounded-md",
                                  quantityFit.tone === "danger" && "border-red-300 bg-red-50 text-red-700",
                                  quantityFit.tone === "warning" && "border-amber-300 bg-amber-50 text-amber-700",
                                  quantityFit.tone === "good" && "border-emerald-300 bg-emerald-50 text-emerald-700",
                                )}
                              >
                                {quantityFit.label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-1">
                                {mode === "request" ? (
                                  <>
                                    <Button type="button" variant="outline" size="sm" aria-label={`${textbookTitle} 요청 수정`} onClick={() => onSelectLine(line, order)}>
                                      <Pencil className="mr-1 size-3.5" />
                                      수정
                                    </Button>
                                    {!textbook ? (
                                      <Button type="button" variant="outline" size="sm" aria-label={`${textbookTitle} 마스터 등록`} onClick={() => onRegisterTextbook(line, order)}>
                                        마스터 등록
                                      </Button>
                                    ) : null}
                                    {textbookTitle !== "-" ? (
                                      <Button type="button" variant="outline" size="sm" asChild>
                                        <a href={buildKyoboSearchUrl(textbookTitle)} target="_blank" rel="noreferrer">
                                          <Search className="mr-1 size-3.5" />
                                          교보 검색
                                        </a>
                                      </Button>
                                    ) : null}
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      aria-label={`${textbookTitle} 주문으로 전환`}
                                      disabled={!textbook}
                                      onClick={() => onSelectLine(line, order, "order")}
                                    >
                                      주문
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Button type="button" variant="outline" size="sm" aria-label={`${textbookTitle} 주문·입고 수정`} onClick={() => onSelectLine(line, order)}>
                                      <Pencil className="mr-1 size-3.5" />
                                      수정
                                    </Button>
                                    {nextStatus ? (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        aria-label={`${textbookTitle} ${processAction?.label || "이동"}`}
                                        disabled={saving === `purchase-move-${lineId}`}
                                        onClick={() => {
                                          if (processAction) {
                                            onSelectLine(line, order, processAction.stage);
                                            return;
                                          }
                                          onMoveLine(line, order, nextStatus as PurchaseKanbanStatus);
                                        }}
                                      >
                                        {processAction?.label || "이동"}
                                      </Button>
                                    ) : null}
                                  </>
                                )}
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  aria-label={`${textbookTitle} ${mode === "request" ? "요청" : "주문·입고"} 건 삭제`}
                                  disabled={saving === `purchase-delete-${lineId}`}
                                  onClick={() => onDeleteLine(line, order)}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="bg-muted/20 text-xs text-muted-foreground">
                        <TableCell colSpan={mode === "request" ? 7 : 8} className="text-right">합계</TableCell>
                        <TableCell className="text-right">{formatQuantity(requestedTotal)}</TableCell>
                        {mode === "order" ? (
                          <>
                            <TableCell className="text-right">{formatQuantity(orderedTotal)}</TableCell>
                            <TableCell className="text-right">{formatQuantity(receivedTotal)}</TableCell>
                          </>
                        ) : null}
                        <TableCell colSpan={2} />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              ) : null}
              {!collapsed && rows.length === 0 ? (
                <ProcessGroupEmptyState
                  label={getPurchaseProcessEmptyLabel(mode, group.id, requestFilter, orderFilter, searchQuery)}
                  actionLabel={mode === "request" ? "요청 바로 추가" : "주문 바로 추가"}
                  onAction={onAddLine}
                />
              ) : null}
            </section>
          );
          })}
        </div>
      )}
    </div>
  );
}

function SalesProcessTable({
  sales,
  lines,
  textbooks,
  classes,
  locations,
  saving,
  statusFilter,
  searchQuery,
  onStatusFilterChange,
  onAddSale,
  onUpdateStatus,
}: {
  sales: Row[];
  lines: Row[];
  textbooks: Row[];
  classes: Row[];
  locations: Row[];
  saving: string;
  statusFilter: SalesProcessFilter;
  searchQuery: string;
  onStatusFilterChange: (filter: SalesProcessFilter) => void;
  onAddSale: () => void;
  onUpdateStatus: (line: Row, status: "issued") => void;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const salesById = new Map(sales.map((sale) => [getRecordId(sale), sale]));
  const grouped = groupSaleLinesByStatus({ lines }) as Record<string, Row[]>;
  const groups = [
    { id: "charged", title: "출고 대기" },
    { id: "issued", title: "출고 완료" },
    { id: "cancelled", title: "취소" },
    { id: "returned", title: "반품" },
  ] as const;
  const visibleGroups =
    statusFilter === "waiting" ? groups.filter((group) => group.id === "charged") :
    statusFilter === "issued" ? groups.filter((group) => group.id === "issued") :
    groups;

  function toggleGroup(id: string) {
    setCollapsedGroups((current) => ({ ...current, [id]: !current[id] }));
  }

  function collapseAllGroups() {
    setCollapsedGroups(Object.fromEntries(visibleGroups.map((group) => [group.id, true])));
  }

  function expandAllGroups() {
    setCollapsedGroups({});
  }

  function getVisibleSaleRows(groupId: string) {
    return (grouped[groupId] || []).filter((line) => {
      const sale = salesById.get(text(line.sale_id || line.saleId));
      return matchesSaleLineQuery({ line, sale, query: searchQuery, textbooks, classes, locations });
    });
  }

  const visibleRowCount = visibleGroups.reduce((sum, group) => sum + getVisibleSaleRows(group.id).length, 0);
  const visibleTotalQuantity = visibleGroups.reduce(
    (sum, group) => sum + getVisibleSaleRows(group.id).reduce((groupSum, line) => groupSum + (numberValue(line.quantity) || 1), 0),
    0,
  );
  const renderedGroups = visibleGroups.filter((group) => getVisibleSaleRows(group.id).length > 0);
  const emptyGroupId = visibleGroups[0]?.id || "charged";
  const getSalesFilterCount = (filter: SalesProcessFilter) => {
    const targetGroups =
      filter === "waiting" ? groups.filter((group) => group.id === "charged") :
      filter === "issued" ? groups.filter((group) => group.id === "issued") :
      groups;
    return targetGroups.reduce((sum, group) => sum + getVisibleSaleRows(group.id).length, 0);
  };

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-background">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b p-3">
        <div className="flex flex-wrap gap-1">
          {[
            { value: "all", label: "전체 출고" },
            { value: "waiting", label: "출고 대기" },
            { value: "issued", label: "출고 완료" },
          ].map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={statusFilter === option.value ? "default" : "outline"}
              className="h-8 rounded-md"
              aria-pressed={statusFilter === option.value}
              onClick={() => onStatusFilterChange(option.value as SalesProcessFilter)}
            >
              <span>{option.label}</span>
              <span className={cn(
                "ml-2 rounded px-1.5 text-[11px] font-semibold",
                statusFilter === option.value ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
              )}>
                {formatQuantity(getSalesFilterCount(option.value as SalesProcessFilter))}
              </span>
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Badge variant="secondary" className="h-8 rounded-md px-2">
            표시 {formatQuantity(visibleRowCount)}건
          </Badge>
          <Badge variant="outline" className="h-8 rounded-md px-2">
            수량 {formatQuantity(visibleTotalQuantity)}
          </Badge>
          {visibleRowCount > 0 ? (
            <>
              <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={collapseAllGroups}>
                전체 접기
              </Button>
              <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={expandAllGroups}>
                전체 펼치기
              </Button>
            </>
          ) : null}
          {visibleRowCount > 0 ? (
            <Button type="button" size="sm" className="shrink-0" onClick={onAddSale}>
              <Plus className="mr-2 size-4" />
              출고 추가
            </Button>
          ) : null}
        </div>
      </div>

      {visibleRowCount === 0 ? (
        <ProcessGroupEmptyState
          label={getSalesProcessEmptyLabel(emptyGroupId, statusFilter, searchQuery)}
          actionLabel="출고 바로 추가"
          onAction={onAddSale}
        />
      ) : (
        <div className="grid gap-0">
          {renderedGroups.map((group) => {
          const rows = getVisibleSaleRows(group.id);
          const collapsed = Boolean(collapsedGroups[group.id]);
          const totalCount = rows.length;
          const totalQuantity = rows.reduce((sum, line) => sum + (numberValue(line.quantity) || 1), 0);

          return (
            <section key={group.id} className="border-b last:border-b-0">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-3 text-left text-sm font-medium hover:bg-muted/60"
                aria-expanded={!collapsed}
                aria-label={`${group.title} 그룹 ${collapsed ? "펼치기" : "접기"}`}
                onClick={() => toggleGroup(group.id)}
              >
                {collapsed ? <ChevronRight className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                <span className={cn("size-2 rounded-full", processStatusDotClass(group.id))} />
                <span>{group.title}</span>
                <Badge variant="secondary" className="rounded-md">{formatQuantity(totalCount)}</Badge>
                <Badge variant="outline" className="ml-auto rounded-md bg-background">
                  수량 {formatQuantity(totalQuantity)}
                </Badge>
              </button>
              {!collapsed && totalCount > 0 ? (
                <div className="max-w-full overflow-x-auto">
                  <Table className="w-full min-w-[920px]">
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow className="bg-muted/30">
                        <TableHead className="w-[112px]">진행상태</TableHead>
                        <TableHead className="w-[96px]">출고월</TableHead>
                        <TableHead className="w-[120px]">학생</TableHead>
                        <TableHead className="w-[150px]">수업</TableHead>
                        <TableHead>교재명</TableHead>
                        <TableHead className="w-[88px]">위치</TableHead>
                        <TableHead className="w-[72px] text-right">수량</TableHead>
                        <TableHead className="w-[120px] text-right">작업</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((line) => {
                        const lineId = getRecordId(line);
                        const sale = salesById.get(text(line.sale_id || line.saleId));
                        const textbook = getTextbookById(textbooks, text(line.textbook_id || line.textbookId));
                        const classItem = getClassById(classes, text(line.class_id || sale?.class_id));
                        const rawStatus = text(line.status || sale?.status) || group.id;
                        const status = rawStatus === "paid" ? "charged" : rawStatus;
                        const quantity = numberValue(line.quantity) || 1;
                        const textbookTitle = textbook ? getTextbookTitle(textbook) : text(line.textbook_id);
                        const studentName = text(line.student_name || line.student_id) || "-";
                        const locationName = getLocationName(locations, text(line.location_id || line.locationId || sale?.location_id || sale?.locationId)) || "-";

                        return (
                          <TableRow key={lineId}>
                            <TableCell>
                              <Badge variant="outline" className={cn("rounded-md", processStatusPillClass(status))}>
                                {saleStatusLabels[status] || status}
                              </Badge>
                            </TableCell>
                            <TableCell>{text(line.charge_month || sale?.charge_month) || "-"}</TableCell>
                            <TableCell className="max-w-[120px] truncate">{studentName}</TableCell>
                            <TableCell className="max-w-[150px] truncate">{classItem ? getClassName(classItem) : "-"}</TableCell>
                            <TableCell>
                              <div className="max-w-[360px] truncate font-medium">{textbookTitle}</div>
                              <div className="text-xs text-muted-foreground">{formatCompactDateTime(getSaleEventAt(line, sale, status))}</div>
                            </TableCell>
                            <TableCell className="max-w-[88px] truncate">{locationName}</TableCell>
                            <TableCell className="text-right">{formatQuantity(quantity)}</TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-1">
                                {status !== "issued" && status !== "cancelled" && status !== "returned" ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    aria-label={`${studentName} ${textbookTitle} 출고 완료 처리`}
                                    disabled={saving === `sale-line-${lineId}`}
                                    onClick={() => onUpdateStatus(line, "issued")}
                                  >
                                    출고
                                  </Button>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="bg-muted/20 text-xs text-muted-foreground">
                        <TableCell colSpan={6} className="text-right">합계</TableCell>
                        <TableCell className="text-right">{formatQuantity(totalQuantity)}</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              ) : null}
              {!collapsed && totalCount === 0 ? (
                <ProcessGroupEmptyState
                  label={getSalesProcessEmptyLabel(group.id, statusFilter, searchQuery)}
                  actionLabel="출고 바로 추가"
                  onAction={onAddSale}
                />
              ) : null}
            </section>
          );
          })}
        </div>
      )}
    </div>
  );
}

function MonthlyClosingTable({ rows }: { rows: Row[] }) {
  const recentRows = [...rows].slice(-12).reverse();
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="min-w-[720px]">
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead>월</TableHead>
            <TableHead>과목</TableHead>
            <TableHead className="text-right">입고</TableHead>
            <TableHead className="text-right">출고</TableHead>
            <TableHead className="text-right">기말</TableHead>
            <TableHead className="text-right">차이</TableHead>
            <TableHead>상태</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recentRows.map((row) => (
            <TableRow key={getRecordId(row)}>
              <TableCell>{text(row.closing_month)}</TableCell>
              <TableCell>{text(row.subject) === "all" ? "전체" : getSubjectLabel(row.subject)}</TableCell>
              <TableCell className="text-right">{formatQuantity(row.purchase_quantity)}</TableCell>
              <TableCell className="text-right">{formatQuantity(row.sale_quantity)}</TableCell>
              <TableCell className="text-right">{formatQuantity(row.ending_quantity)}</TableCell>
              <TableCell className="text-right">{formatCurrency(row.settlement_difference)}</TableCell>
              <TableCell><Badge variant="outline">{text(row.status) || "대기"}</Badge></TableCell>
            </TableRow>
          ))}
          {recentRows.length === 0 ? <EmptyRow colSpan={7} label="마감 이력이 없습니다" /> : null}
        </TableBody>
      </Table>
    </div>
  );
}

function EmptyRow({ colSpan, label, compact = false }: { colSpan: number; label: string; compact?: boolean }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className={cn(compact ? "h-16" : "h-28", "text-center text-muted-foreground")}>
        {label}
      </TableCell>
    </TableRow>
  );
}
