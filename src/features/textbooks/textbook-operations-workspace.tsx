"use client";

import { Fragment, FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Barcode,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ClipboardCheck,
  Copy,
  FileImage,
  PackageCheck,
  Plus,
  Pencil,
  Printer,
  RefreshCw,
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
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { useDataTableColumns, type DataTableColumn } from "@/components/data-table/data-table-columns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { captureElementAsPdfBlob, captureElementAsPngBlob, downloadBlob } from "@/lib/export-as-image";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

import {
  buildTeacherTextbookIssueDraft,
  buildTextbookMonthlyClosing,
  buildTextbookSaleDraft,
  filterStockMovesForClosing,
  getRecordId,
  getTextbookByReference,
  getTextbookCopyScope,
  getTextbookPurchaseUnitCost,
  getTextbookSalePrice,
  getTextbookActionErrorMessage,
  getTextbookTitle,
  groupPurchaseLinesByStatus,
  groupSaleLinesByStatus,
  listIds,
  normalizeBarcodeValue,
  normalizeTextbookLookupValue,
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
type PurchaseOrderFilter = "all" | "waiting" | "partial" | "returnable" | "returned";
type SalesProcessFilter = "all" | "waiting" | "issued" | "returned" | "cancelled";
type TextbookOpsQueueKey = "unregistered" | "order" | "partial" | "issue" | "stockRisk";
type PurchaseKanbanStatus = "requested" | "ordered" | "partially_received" | "received" | "cancelled" | "returned";
type TextbookCopyScope = "student" | "teacher";
type PurchaseQuantityKind = "requested" | "ordered" | "received";
type PurchaseKanbanDraft = {
  textbookId: string;
  requestedTextbookTitle: string;
  copyScope: TextbookCopyScope;
  classId: string;
  supplierId: string;
  locationId: string;
  requestBy: string;
  requestedQuantity: string;
  orderedQuantity: string;
  receivedQuantity: string;
  studentRequestedQuantity: string;
  teacherRequestedQuantity: string;
  studentOrderedQuantity: string;
  teacherOrderedQuantity: string;
  studentReceivedQuantity: string;
  teacherReceivedQuantity: string;
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
type InventoryHistoryRow = {
  id: string;
  kind: "move" | "count";
  sourceId: string;
  linkedMoveId: string;
  at: string;
  textbookTitle: string;
  locationName: string;
  change: string;
  action: string;
  actor: string;
  memo: string;
};
type TextbookSearchIndex = {
  haystack: string;
  barcodeText: string;
};
type TextbookHandoffLine = {
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
type PreparedHandoffDownload = {
  id: string;
  label: string;
  filename: string;
  url: string;
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
type TextbookHandoffGroup = {
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
type TextbookConfirmationPreviewItem = {
  id: string;
  title: string;
  detail: string;
};
type TextbookConfirmationRequest = {
  title: string;
  description: string;
  confirmLabel: string;
  items?: TextbookConfirmationPreviewItem[];
  onConfirm: () => void;
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

const textbookCopyScopeOptions = [
  { value: "student", label: "학생용" },
  { value: "teacher", label: "교사용" },
] as const;

const purchaseProcessQuantityColumns = [
  { id: "studentRequested", label: "학생용 요청", scope: "student", kind: "requested", required: true },
  { id: "studentOrdered", label: "학생용 주문", scope: "student", kind: "ordered", orderOnly: true, required: true },
  { id: "studentReceived", label: "학생용 입고", scope: "student", kind: "received", orderOnly: true, required: true },
  { id: "teacherRequested", label: "교사용 요청", scope: "teacher", kind: "requested", required: true },
  { id: "teacherOrdered", label: "교사용 주문", scope: "teacher", kind: "ordered", orderOnly: true, required: true },
  { id: "teacherReceived", label: "교사용 입고", scope: "teacher", kind: "received", orderOnly: true, required: true },
] satisfies Array<{
  id: string;
  label: string;
  scope: TextbookCopyScope;
  kind: PurchaseQuantityKind;
  orderOnly?: boolean;
  required?: boolean;
}>;

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
  schoolLevel: "keep",
  gradeLevel: "keep",
  category: "",
  publisher: "",
  price: "",
  status: "keep",
};

const emptyPurchaseForm = {
  requestStage: "request",
  copyScope: "student",
  textbookId: "",
  requestedTextbookTitle: "",
  classId: "",
  supplierId: "",
  locationId: "",
  requestBy: "",
  requestedQuantity: "1",
  orderedQuantity: "",
  receivedQuantity: "",
  studentRequestedQuantity: "1",
  teacherRequestedQuantity: "",
  studentOrderedQuantity: "",
  teacherOrderedQuantity: "",
  studentReceivedQuantity: "",
  teacherReceivedQuantity: "",
  unitCost: "",
  statementNumber: "",
  memo: "",
};

const emptySaleForm = {
  copyScope: "student",
  classId: "",
  textbookId: "",
  teacherName: "",
  quantity: "1",
  chargeMonth: currentMonth(),
  locationId: "",
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
const INVENTORY_COUNT_PAGE_SIZE = 30;
const MASTER_TEXTBOOK_PAGE_SIZE = 60;
const TEXTBOOK_DATA_LOAD_TIMEOUT_MS = 12_000;
const textbookHistoryDeleteAdminEmails = new Set(["yeoyuasset@naver.com"]);

const inventoryAuditFilterLabels: Record<InventoryAuditFilter, string> = {
  recommended: "할 일",
  pending: "대기",
  done: "완료",
  all: "전체",
};

const textbookQualityFilterLabels: Record<TextbookQualityFilter, string> = {
  all: "사용중",
  attention: "정리 필요",
  duplicate: "중복",
  missingCode: "코드 없음",
  missingPublisher: "출판사 없음",
  missingCategory: "분류 없음",
  missingPrice: "가격 없음",
  subjectMismatch: "과목 확인",
  inactive: "미사용 보관함",
};
const textbookQualityIssueFilterKeys: Exclude<TextbookQualityFilter, "all" | "attention">[] = [
  "duplicate",
  "missingCode",
  "missingPublisher",
  "missingCategory",
  "missingPrice",
  "subjectMismatch",
  "inactive",
];

const textbookTabTriggerClassName =
  "gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm";
const dialogFooterClassName =
  "sticky bottom-0 z-20 mt-1 flex w-full min-w-0 max-w-full justify-self-stretch flex-col gap-2 border-t bg-background/95 px-0 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:flex-row sm:justify-end [&>button]:w-full sm:[&>button]:w-auto";
const stickyActionHeadClassName =
  "sticky right-0 bg-muted/30 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]";
const stickyActionCellClassName =
  "sticky right-0 bg-background shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.35)]";

function purchaseQuantityHeaderPillClassName(scope: TextbookCopyScope) {
  return cn(
    "inline-flex h-6 items-center justify-center rounded-full px-2 text-[11px] font-semibold leading-none ring-1",
    scope === "student"
      ? "bg-sky-100 text-sky-800 ring-sky-200"
      : "bg-amber-100 text-amber-800 ring-amber-200",
  );
}

function purchaseQuantityCellClassName(scope: TextbookCopyScope) {
  return cn(
    "text-right font-medium tabular-nums",
    scope === "student"
      ? "bg-sky-50/70 text-sky-950"
      : "bg-amber-50/70 text-amber-950",
  );
}

function withTextbookDataLoadTimeout<T>(promise: Promise<T>) {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new Error("교재관리 데이터를 불러오는 데 시간이 오래 걸립니다. 다시 시도하세요."));
    }, TEXTBOOK_DATA_LOAD_TIMEOUT_MS);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId);
    }
  });
}

function buildPurchaseProcessColumns(mode: "request" | "order", showSelection: boolean) {
  return [
    showSelection ? { id: "select", label: "선택", required: true } : null,
    { id: "status", label: "진행상태", required: true },
    mode === "order" ? { id: "supplier", label: "총판" } : null,
    mode === "order" ? { id: "unitCost", label: "단가" } : null,
    { id: "eventAt", label: "처리일시" },
    { id: "requester", label: "요청자" },
    { id: "textbook", label: "교재명", required: true },
    { id: "location", label: "위치" },
    { id: "class", label: "수업" },
    ...purchaseProcessQuantityColumns
      .filter((column) => mode === "order" || !column.orderOnly)
      .map((column) => ({ id: column.id, label: column.label, required: column.required })),
    { id: "decision", label: "판단" },
    { id: "action", label: "작업", required: true },
  ].filter(Boolean) as DataTableColumn[];
}

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
  all: "전체",
  waiting: "진행중",
  partial: "부분입고",
  returnable: "반품 가능",
  returned: "반품 완료",
};
const purchaseRequestFilterValues: PurchaseRequestFilter[] = ["all", "unregistered", "orderable"];
const purchaseBoardScopeValues: PurchaseBoardScope[] = ["active", "recent", "all"];
const purchaseOrderFilterValues: PurchaseOrderFilter[] = ["all", "waiting", "partial", "returnable", "returned"];
const salesProcessFilterValues: SalesProcessFilter[] = ["all", "waiting", "issued", "returned", "cancelled"];

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

function textPreservingZero(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function getRowFieldText(row: Row | undefined, ...fieldNames: string[]) {
  if (!row) return "";
  for (const fieldName of fieldNames) {
    if (!Object.prototype.hasOwnProperty.call(row, fieldName)) continue;
    const value = textPreservingZero(row[fieldName]);
    if (value) return value;
  }
  return "";
}

function firstNonBlankText(...values: unknown[]) {
  for (const value of values) {
    const normalized = textPreservingZero(value);
    if (normalized) return normalized;
  }
  return "";
}

function isEditableShortcutTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

function normalizeEmailValue(value: unknown) {
  return text(value).replace(/\s+/g, "").toLowerCase();
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
  return text(row.publisher || row.publisher_name || row.publisherName) || "미분류";
}

function getKnownPublisherLabel(row: Row) {
  const publisherLabel = getPublisherLabel(row);
  return publisherLabel === "미분류" ? "" : publisherLabel;
}

function getPublisherSettingLabel(row: Row) {
  return text(row.name || row.publisher || row.publisher_name || row.publisherName);
}

function uniqueSortedLabels(values: unknown[]) {
  const labelsByKey = new Map<string, string>();
  for (const value of values) {
    const label = text(value);
    if (!label || label === "미분류") continue;
    const key = label.toLowerCase();
    if (!labelsByKey.has(key)) {
      labelsByKey.set(key, label);
    }
  }
  return [...labelsByKey.values()].sort((left, right) => left.localeCompare(right, "ko", { numeric: true }));
}

function compactUniqueLabels(parts: Array<unknown>) {
  const seen = new Set<string>();
  return parts
    .map(text)
    .filter(Boolean)
    .filter((part) => {
      if (part === "-") return false;
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function getTextbookIdentityLabel(row: Row) {
  return compactUniqueLabels([
    getTextbookTitle(row),
    getKnownPublisherLabel(row),
    getSubjectLabel(row.subject),
    getTextbookGradeLabel(getTextbookGradeLevel(row)),
    getTextbookSubSubject(row),
  ]).join(" · ");
}

function getQualityIssueSummary(labels: Array<{ label: string }>) {
  return labels.map((issue) => issue.label).join(", ") || "정리 완료";
}

function getCategoryLabel(row: Row) {
  return getTextbookCategoryLabel(row);
}

function getTextbookTitleKey(row: Row) {
  return normalizeTextbookLookupValue(getTextbookTitle(row), { compact: true });
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

function hasTextbookActionableQualityIssue(row: Row, duplicateTitleKeys: Set<string>) {
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
  if (!isActiveTextbook(row)) return true;
  return hasTextbookActionableQualityIssue(row, duplicateTitleKeys);
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
  if (filter === "inactive") return !isActiveTextbook(row);
  if (!isActiveTextbook(row)) return false;
  if (filter === "all") return true;
  if (filter === "attention") return hasTextbookActionableQualityIssue(row, duplicateTitleKeys);
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

function getPositivePurchaseQuantityText(value: unknown) {
  const normalized = textPreservingZero(value);
  return numberValue(normalized) > 0 ? normalized : "";
}

function normalizeMoneyInput(value: unknown) {
  return text(value).replace(/[^\d]/g, "");
}

function normalizeQuantityInput(value: unknown, options: { allowZero?: boolean } = {}) {
  const digits = text(value).replace(/[^\d]/g, "");
  if (!digits) return "";
  const quantity = numberValue(digits);
  if (!Number.isFinite(quantity)) return "";
  if (!options.allowZero && quantity <= 0) return "";
  return String(Math.max(options.allowZero ? 0 : 1, quantity));
}

const purchaseQuantityFieldNames = new Set([
  "studentRequestedQuantity",
  "teacherRequestedQuantity",
  "studentOrderedQuantity",
  "teacherOrderedQuantity",
  "studentReceivedQuantity",
  "teacherReceivedQuantity",
]);

function isPurchaseQuantityField(name: string) {
  return purchaseQuantityFieldNames.has(name);
}

function normalizePurchaseQuantityField(name: string, value: unknown) {
  return normalizeQuantityInput(value, { allowZero: isPurchaseQuantityField(name) });
}

function getPurchaseScopeQuantity(draft: PurchaseKanbanDraft | typeof emptyPurchaseForm, scope: TextbookCopyScope, kind: "requested" | "ordered" | "received") {
  const prefix = scope === "teacher" ? "teacher" : "student";
  const fieldName = `${prefix}${kind[0].toUpperCase()}${kind.slice(1)}Quantity` as keyof typeof emptyPurchaseForm;
  return text((draft as Record<string, unknown>)[fieldName]);
}

function normalizeInlineTextInput(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trimStart();
}

function normalizeStoredTextInput(value: unknown) {
  return text(value).replace(/\s+/g, " ");
}

function normalizeMonthInput(value: unknown, fallback = currentMonth()) {
  const month = text(value).slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month) ? month : fallback;
}

function getSaleLineQuantity(line: Row) {
  return Math.max(1, numberValue(line.quantity) || 1);
}

function getSaleLineUnitPrice(line: Row, textbook: Row | undefined) {
  return numberValue(line.unit_price || line.unitPrice) || getTextbookSalePrice(textbook || {});
}

function getSaleLineAmount(line: Row, textbook: Row | undefined) {
  return getSaleLineUnitPrice(line, textbook) * getSaleLineQuantity(line);
}

function getSaleLineMonth(line: Row, sale: Row | undefined) {
  return normalizeMonthInput(line.charge_month || line.chargeMonth || sale?.charge_month || sale?.chargeMonth);
}

function getSaleLineStatus(line: Row, sale: Row | undefined) {
  const rawStatus = text(line.status || sale?.status) || "charged";
  return rawStatus === "paid" ? "charged" : rawStatus;
}

function isBillableSaleLineStatus(status: string) {
  return status !== "cancelled" && status !== "returned" && status !== "excluded";
}

function formatCurrency(value: unknown) {
  const amount = numberValue(value);
  if (!amount) return "-";
  return `${new Intl.NumberFormat("ko-KR").format(amount)}원`;
}

function formatQuantity(value: unknown) {
  return new Intl.NumberFormat("ko-KR").format(numberValue(value));
}

const TEXTBOOK_HANDOFF_BUSINESS_NAME = "TIPS 영어수학학원";

function formatKoreanDocumentDate(value: Date | string | number = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return formatKoreanDocumentDate();
  }
  return `${date.getFullYear()}년 ${formatQuantity(date.getMonth() + 1)}월 ${formatQuantity(date.getDate())}일`;
}

function getTextbookHandoffDocumentMeta(format: "default" | "purchase-order" | "purchase-return") {
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

function formatPurchaseScopeQuantityMetric(studentQuantity: number, teacherQuantity: number) {
  return [
    studentQuantity > 0 ? `학생용 ${formatQuantity(studentQuantity)}권` : "",
    teacherQuantity > 0 ? `교사용 ${formatQuantity(teacherQuantity)}권` : "",
  ].filter(Boolean).join(" · ") || "0권";
}

function formatPurchaseUnitCost(value: unknown, textbook: Row | undefined) {
  const amount = numberValue(value);
  if (amount > 0) {
    return formatCurrency(amount);
  }

  return getTextbookSalePrice(textbook || {}) > 0 ? "0원" : "-";
}

function getTextbookDeleteResultMessage(
  result: { deletedIds?: string[]; archivedIds?: string[] } | undefined,
  fallbackCount: number,
) {
  const deletedCount = result?.deletedIds?.length || 0;
  const archivedCount = result?.archivedIds?.length || 0;

  if (!result) {
    return `${formatQuantity(fallbackCount)}개 교재를 삭제하거나 미사용으로 전환했습니다.`;
  }
  if (deletedCount > 0 && archivedCount > 0) {
    return `${formatQuantity(deletedCount)}개 삭제, ${formatQuantity(archivedCount)}개 미사용으로 전환했습니다.`;
  }
  if (archivedCount > 0) {
    return `${formatQuantity(archivedCount)}개 교재를 이력 보존을 위해 미사용으로 전환했습니다.`;
  }
  return `${formatQuantity(deletedCount)}개 교재를 삭제했습니다.`;
}

function buildTextbookCleanupPreviewRows(rows: Row[]) {
  return rows.map((row) => {
    const title = getTextbookTitle(row) || "교재명 없음";
    const detail = [
      getPublisherLabel(row),
      getCategoryLabel(row),
      normalizeStatusValue(row.status) === "inactive" ? "미사용" : "사용중",
    ].filter(Boolean).join(" · ");

    return {
      id: getRecordId(row) || title,
      title,
      detail,
    };
  });
}

function getSavedPurchaseRequestFilter(stage: string, hasCatalogTextbook: boolean): PurchaseRequestFilter {
  if (stage !== "request") return "all";
  return hasCatalogTextbook ? "orderable" : "unregistered";
}

function getSavedPurchaseOrderFilter(stage: string, hasCatalogTextbook: boolean): PurchaseOrderFilter {
  if (stage === "request") {
    return hasCatalogTextbook ? "waiting" : "all";
  }
  if (stage === "order") return "waiting";
  return "all";
}

function getSavedPurchaseBoardScope(stage: string): PurchaseBoardScope {
  return stage === "receive" ? "recent" : "active";
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function formatLoadedAt(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function getStudentName(row: Row) {
  return text(row.name || row.student_name || row.studentName || row.id);
}

function getStudentGradeLabel(row: Row | undefined) {
  return text(row?.grade || row?.grade_label || row?.gradeLabel || row?.school_grade || row?.schoolGrade) || "-";
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

function getConfiguredSupplierIdForTextbook(textbook: Row | undefined, publisherSupplierLinks: Row[], publishers: Row[] = []) {
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

function getConfiguredTextbookPurchaseUnitCost(
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

function getTextbookCopyScopeLabel(value: unknown) {
  return getTextbookCopyScope({ copyScope: value }) === "teacher" ? "교사용" : "학생용";
}

function normalizeTextbookLookup(value: unknown) {
  return normalizeTextbookLookupValue(value);
}

function getTextbookById(textbooks: Row[], id: string) {
  return getTextbookByReference(textbooks, id);
}

function buildTextbookLookupMap(textbooks: Row[]) {
  const lookup = new Map<string, Row>();
  for (const textbook of textbooks) {
    const aliases = [
      getRecordId(textbook),
      getTextbookTitle(textbook),
      textbook.name,
      textbook.isbn13,
      textbook.isbn,
      textbook.barcode,
    ];
    for (const alias of aliases) {
      const key = normalizeTextbookLookup(alias);
      if (key && !lookup.has(key)) {
        lookup.set(key, textbook);
      }
      const compactKey = normalizeTextbookLookupValue(alias, { compact: true });
      if (compactKey && !lookup.has(compactKey)) {
        lookup.set(compactKey, textbook);
      }
    }
  }
  return lookup;
}

function getTextbookFromLookup(lookup: Map<string, Row>, reference: unknown) {
  return lookup.get(normalizeTextbookLookup(reference)) ||
    lookup.get(normalizeTextbookLookupValue(reference, { compact: true }));
}

function buildTextbookSearchIndex(row: Row): TextbookSearchIndex {
  const compactTitle = normalizeTextbookLookupValue(getTextbookTitle(row), { compact: true });
  return {
    haystack: [
      getTextbookTitle(row),
      compactTitle,
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
      .toLowerCase(),
    barcodeText: normalizeBarcodeValue(`${text(row.isbn13)} ${text(row.barcode)}`),
  };
}

function buildLocationNameLookup(locations: Row[]) {
  const lookup = new Map<string, string>();
  for (const location of locations) {
    const name = text(location.name || location.code);
    for (const alias of [getRecordId(location), location.code]) {
      const key = text(alias);
      if (key && name) {
        lookup.set(key, name);
      }
    }
  }
  return lookup;
}

function getLocationNameFromLookup(lookup: Map<string, string>, reference: unknown) {
  const key = text(reference);
  return lookup.get(key) || key;
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

function getStudentNameById(studentsById: Map<string, Row>, id: string) {
  const student = studentsById.get(id);
  return text(student?.name || student?.student_name || student?.studentName || id) || "-";
}

function getSaleLineRecipientName(line: Row, studentsById: Map<string, Row>) {
  if (getTextbookCopyScope(line) === "teacher") {
    return text(line.teacher_name || line.teacherName) || "선생님 미지정";
  }

  const studentId = text(line.student_id || line.studentId);
  return text(line.student_name || getStudentNameById(studentsById, studentId)) || "-";
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

function getInventoryCurrentQuantityDraft(row: InventoryCountRow) {
  return String(Math.max(0, numberValue(row.currentQuantity)));
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

function getTextbookReferenceState(textbooks: Row[], reference: unknown) {
  const value = text(reference);
  if (!value) return "none";
  const textbook = getTextbookById(textbooks, value);
  if (!textbook) return "missing";
  return isActiveTextbook(textbook) ? "active" : "inactive";
}

function shouldShowOperationalPurchaseLine(line: Row, order: Row | undefined, textbooks: Row[]) {
  const draft = buildPurchaseCardDraft(line, order);
  const reference = draft.textbookId || draft.requestedTextbookTitle;
  const state = getTextbookReferenceState(textbooks, reference);
  return state !== "inactive";
}

function shouldShowOperationalSaleLine(line: Row, textbooks: Row[]) {
  const reference = text(line.textbook_id || line.textbookId);
  return getTextbookReferenceState(textbooks, reference) === "active";
}

function inventoryQuantityTone(totalQuantity: number) {
  if (totalQuantity < 0) return "text-red-700";
  if (totalQuantity === 0) return "text-zinc-500";
  if (totalQuantity <= INVENTORY_LOW_STOCK_THRESHOLD) return "text-amber-700";
  return "text-foreground";
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
    if (!shouldShowOperationalPurchaseLine(line, order, data.textbooks)) {
      continue;
    }
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
    if (!shouldShowOperationalSaleLine(line, data.textbooks)) {
      continue;
    }
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

function getHandoffDomId(prefix: string, id: string) {
  return `${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function getSafeExportFileName(value: string) {
  return text(value)
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "textbook-export";
}

function getElementById(id: string) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error("내보낼 영역을 찾을 수 없습니다.");
  }
  return element;
}

function getHandoffCaptureElement(elementId: string) {
  const element = getElementById(elementId);
  return element.matches("[data-handoff-capture-target]")
    ? element
    : element.querySelector<HTMLElement>("[data-handoff-capture-target]") || element;
}

async function writeClipboardText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through to the selection-based copy path when the browser blocks clipboard writes.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, value.length);
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("클립보드 권한이 없어 복사하지 못했습니다.");
  }
}

function createPreparedHandoffDownload(blob: Blob, filename: string, extension: "png" | "pdf", label: string) {
  const safeFilename = `${getSafeExportFileName(filename)}.${extension}`;
  downloadBlob(blob, safeFilename);

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    label,
    filename: safeFilename,
    url: URL.createObjectURL(blob),
  };
}

async function downloadHandoffImage(element: HTMLElement, filename: string) {
  const blob = await captureElementAsPngBlob(element, {
    width: Math.max(720, Math.ceil(element.scrollWidth)),
    padding: 0,
    scale: 2,
    backgroundColor: "#ffffff",
  });

  return createPreparedHandoffDownload(blob, filename, "png", "이미지");
}

async function downloadHandoffPdf(element: HTMLElement, filename: string) {
  const blob = await captureElementAsPdfBlob(element, {
    width: Math.max(720, Math.ceil(element.scrollWidth)),
    padding: 0,
    scale: 2,
    backgroundColor: "#ffffff",
  });

  return createPreparedHandoffDownload(blob, filename, "pdf", "PDF");
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

function purchaseSuccessMessage(stage: string, isEdit: boolean) {
  const stageLabel = purchaseStageLabels[stage] || purchaseActionLabel(stage);
  return isEdit ? `${stageLabel}로 업데이트했습니다.` : `${stageLabel}를 저장했습니다.`;
}

function getPurchaseDialogTitle(stage: unknown, isEdit: boolean) {
  const normalizedStage = text(stage) || "request";
  const title = normalizedStage === "receive" ? "교재 입고" : normalizedStage === "order" ? "교재 주문" : "교재 요청";
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
    requester: normalizedStage === "request" || normalizedStage === "order",
    location: normalizedStage === "request" || normalizedStage === "order" || normalizedStage === "receive",
    requestedQuantity: normalizedStage === "request" || normalizedStage === "order",
    orderedQuantity: normalizedStage === "order" || normalizedStage === "receive",
    receivedQuantity: normalizedStage === "receive",
    statementNumber: normalizedStage === "receive",
    classFit: normalizedStage === "request" || normalizedStage === "order",
  };
}

function buildPurchaseCardDraft(line: Row, order: Row | undefined): PurchaseKanbanDraft {
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

function getPurchaseScopeLines(line: Row) {
  const scopeLines = Array.isArray(line.purchaseScopeLines)
    ? (line.purchaseScopeLines as Row[]).filter(Boolean)
    : [];
  return scopeLines.length > 0 ? scopeLines : [line];
}

function getPurchaseDisplayCaseKey(line: Row, order: Row | undefined, textbooks: Row[]) {
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

function buildPurchaseDisplayRows(rows: Row[], ordersById: Map<string, Row>, textbooks: Row[]) {
  const displayRows = new Map<string, { id: string; line: Row; lines: Row[] }>();
  for (const row of rows) {
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
      line: { ...primaryLine, purchaseScopeLines: nextLines },
      lines: nextLines,
    });
  }
  return [...displayRows.values()];
}

function getPurchaseDisplayScopeQuantity(lines: Row[], scope: TextbookCopyScope, kind: PurchaseQuantityKind) {
  const snakeField = kind === "requested" ? "requested_quantity" : kind === "ordered" ? "ordered_quantity" : "received_quantity";
  const camelField = kind === "requested" ? "requestedQuantity" : kind === "ordered" ? "orderedQuantity" : "receivedQuantity";
  return lines
    .filter((line) => getTextbookCopyScope(line) === scope)
    .reduce((sum, line) => sum + numberValue(line[snakeField] || line[camelField]), 0);
}

function getPurchaseDisplayQuantity(lines: Row[], kind: PurchaseQuantityKind) {
  return getPurchaseDisplayScopeQuantity(lines, "student", kind) + getPurchaseDisplayScopeQuantity(lines, "teacher", kind);
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
  publishers,
  classes,
  suppliers,
  publisherSupplierLinks,
  locations,
}: {
  line: Row;
  order: Row | undefined;
  query: string;
  textbooks: Row[];
  publishers: Row[];
  classes: Row[];
  suppliers: Row[];
  publisherSupplierLinks: Row[];
  locations: Row[];
}) {
  const draft = buildPurchaseCardDraft(line, order);
  const textbook = getTextbookById(textbooks, draft.textbookId || draft.requestedTextbookTitle);
  const configuredSupplierId = getConfiguredSupplierIdForTextbook(textbook, publisherSupplierLinks, publishers) || draft.supplierId;
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
  students,
}: {
  line: Row;
  sale: Row | undefined;
  query: string;
  textbooks: Row[];
  classes: Row[];
  locations: Row[];
  students: Row[];
}) {
  const textbook = getTextbookById(textbooks, text(line.textbook_id || line.textbookId));
  const classItem = getClassById(classes, text(line.class_id || sale?.class_id || sale?.classId));
  const studentsById = new Map(students.map((student) => [getRecordId(student), student]));
  const status = text(line.status || sale?.status || "charged");
  return matchesSearchQuery(query, [
    textbook ? getTextbookTitle(textbook) : text(line.textbook_id || line.textbookId),
    getTextbookCopyScopeLabel(getTextbookCopyScope(line)),
    getClassName(classItem || {}),
    getSaleLineRecipientName(line, studentsById),
    getLocationName(locations, text(line.location_id || line.locationId || sale?.location_id || sale?.locationId)),
    saleStatusLabels[status] || status,
    text(line.charge_month || sale?.charge_month || sale?.chargeMonth),
  ]);
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

function buildPurchaseSupplierHandoffGroups({
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

function buildPurchaseSupplierReturnHandoffGroups({
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

function buildMakeEduBillingHandoffGroups({
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

type SaleHistorySummaryRow = {
  id: string;
  year: string;
  month: string;
  classId: string;
  className: string;
  textbookId: string;
  textbookTitle: string;
  waitingQuantity: number;
  issuedQuantity: number;
  totalQuantity: number;
  latestAt: string;
};

function getSaleHistoryPeriod(line: Row, sale: Row | undefined) {
  const month = text(line.charge_month || line.chargeMonth || sale?.charge_month || sale?.chargeMonth);
  if (/^\d{4}-\d{2}/.test(month)) {
    return month.slice(0, 7);
  }

  const status = text(line.status || sale?.status) || "charged";
  const eventAt = text(getSaleEventAt(line, sale, status));
  if (/^\d{4}-\d{2}/.test(eventAt)) {
    return eventAt.slice(0, 7);
  }

  return currentMonth();
}

function buildSaleHistorySummaryRows({
  sales,
  lines,
  textbooks,
  classes,
}: {
  sales: Row[];
  lines: Row[];
  textbooks: Row[];
  classes: Row[];
}) {
  const salesById = new Map(sales.map((sale) => [getRecordId(sale), sale]));
  const rowsByKey = new Map<string, SaleHistorySummaryRow>();

  for (const line of lines) {
    const sale = salesById.get(text(line.sale_id || line.saleId));
    const rawStatus = text(line.status || sale?.status) || "charged";
    if (rawStatus === "cancelled" || rawStatus === "returned" || rawStatus === "excluded") {
      continue;
    }

    const period = getSaleHistoryPeriod(line, sale);
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
    copyScope: draft.copyScope,
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
  const order = (line.order || {}) as Row;
  const status = text(line.status || order.status);
  if (scope === "all") return true;
  if (status !== "received" && status !== "returned" && status !== "cancelled") return true;
  if (scope === "active") return false;

  const receivedAt = text(order.received_at || order.receivedAt || order.updated_at || order.updatedAt || order.created_at || order.createdAt);
  if (!receivedAt) return true;

  const receivedMs = new Date(receivedAt).getTime();
  if (!Number.isFinite(receivedMs)) return true;

  return Date.now() - receivedMs <= 1000 * 60 * 60 * 24 * 30;
}

function useTextbookOperationsData() {
  const { user, loading: authLoading, role, canManageAll, isAdmin, isStaff } = useAuth();
  const [data, setData] = useState<TextbookOperationsData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState("");
  const [loadDurationMs, setLoadDurationMs] = useState(0);
  const loadRequestIdRef = useRef(0);
  const canLoadManagementTextbookData = canManageAll || isAdmin || isStaff || role === "admin" || role === "staff";

  const load = useCallback(async () => {
    if (authLoading) {
      return;
    }

    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;

    if (!user) {
      setData(emptyData);
      setError("관리자 세션을 확인할 수 없습니다. 다시 로그인해 주세요.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    const startedAt = performance.now();
    try {
      const next = await withTextbookDataLoadTimeout(
        textbookService.listTextbookOperationsData({
          scope: canLoadManagementTextbookData ? "management" : "request",
        }),
      );
      if (loadRequestIdRef.current !== requestId) {
        return;
      }
      setData(next as TextbookOperationsData);
      setLastLoadedAt(new Date().toISOString());
      setLoadDurationMs(Math.max(0, Math.round(performance.now() - startedAt)));
    } catch (loadError) {
      if (loadRequestIdRef.current !== requestId) {
        return;
      }
      setData(emptyData);
      setError(getTextbookActionErrorMessage(loadError));
    } finally {
      if (loadRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [authLoading, canLoadManagementTextbookData, user]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, refresh: load, user, lastLoadedAt, loadDurationMs };
}

function TextbookOpsCommandCenter({
  metrics,
  activeQueueKey,
  onSelectQueue,
}: {
  metrics: ReturnType<typeof buildTextbookOpsMetrics>;
  activeQueueKey: TextbookOpsQueueKey | "";
  onSelectQueue: (key: TextbookOpsQueueKey | "") => void;
}) {
  const actionItems = [
    { key: "unregistered", label: "미등록 요청", value: metrics.unregisteredRequestCount, tone: "text-amber-700" },
    { key: "order", label: "주문 필요", value: metrics.orderNeededCount, tone: "text-blue-700" },
    { key: "partial", label: "부분입고", value: metrics.partialReceiptCount, tone: "text-orange-700" },
    { key: "issue", label: "출고 대기", value: metrics.issueWaitingCount, tone: "text-emerald-700" },
    { key: "stockRisk", label: "재고 부족", value: metrics.stockRiskCount, tone: "text-red-700" },
  ] satisfies Array<{ key: TextbookOpsQueueKey; label: string; value: number; tone: string }>;
  const activeQueueTotal = actionItems.reduce((sum, item) => sum + item.value, 0);
  const activeQueueItem = actionItems.find((item) => item.key === activeQueueKey);
  const queueBadgeValue = activeQueueItem ? activeQueueItem.value : activeQueueTotal;
  const visibleActionItems = actionItems.filter((item) => item.value > 0 || item.key === activeQueueKey);

  if (activeQueueTotal <= 0) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
            type="button"
            variant={activeQueueKey ? "default" : "outline"}
            size="sm"
            className="h-8 max-w-full gap-2 rounded-md px-3"
            aria-label="교재관리 할 일 보기"
            title={activeQueueItem ? `${activeQueueItem.label} 보기` : `할 일 ${formatQuantity(activeQueueTotal)}건`}
          >
            <SlidersHorizontal className="size-3.5" />
            <span className="max-w-[7rem] truncate">{activeQueueItem ? activeQueueItem.label : "할 일"}</span>
            <Badge
              variant={activeQueueKey ? "secondary" : "outline"}
              className={cn("h-5 rounded px-1.5 tabular-nums", activeQueueKey && "bg-primary-foreground text-primary")}
            >
              {formatQuantity(queueBadgeValue)}
            </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] p-2">
        <div className="grid gap-1" aria-label="교재관리 할 일 목록">
          {visibleActionItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={cn(
                "flex h-9 items-center justify-between rounded-md px-2 text-left text-sm transition-colors hover:bg-muted",
                activeQueueKey === item.key && "bg-primary text-primary-foreground hover:bg-primary",
              )}
              aria-current={activeQueueKey === item.key ? "true" : undefined}
              title={`${item.label} ${formatQuantity(item.value)}건`}
              onClick={() => onSelectQueue(item.key)}
            >
              <span className="truncate">{item.label}</span>
              <span className={cn("ml-3 font-semibold tabular-nums", activeQueueKey === item.key ? "text-primary-foreground" : item.tone)}>
                {formatQuantity(item.value)}
              </span>
            </button>
          ))}
          {activeQueueKey ? (
            <Button type="button" variant="ghost" size="sm" className="mt-1 h-8 justify-start rounded-md px-2" onClick={() => onSelectQueue("")}>
              전체 보기
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function getOperationSearchPlaceholder(activeTab: string) {
  if (activeTab === "requests") {
    return "요청 교재명, 수업, 요청자";
  }
  if (activeTab === "purchase") {
    return "주문 교재명, 총판, 수업";
  }
  if (activeTab === "sales") {
    return "출고 교재명, 학생, 수업";
  }
  return "교재명, 수업, 학생";
}

function getOperationSearchLabel(activeTab: string) {
  if (activeTab === "requests") {
    return "요청 검색";
  }
  if (activeTab === "purchase") {
    return "주문·입고 검색";
  }
  if (activeTab === "sales") {
    return "출고 검색";
  }
  return "업무 검색";
}

export function TextbookOperationsWorkspace() {
  const { data, loading, error, refresh, user, lastLoadedAt, loadDurationMs } = useTextbookOperationsData();
  const { role, canManageAll, isAdmin, isStaff } = useAuth();
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const [actionErrorMessage, setActionErrorMessage] = useState("");
  const [query, setQuery] = useState("");
  const [operationQuery, setOperationQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const deferredOperationQuery = useDeferredValue(operationQuery);
  const masterSearchRef = useRef<HTMLInputElement>(null);
  const operationSearchRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState("master");
  const [masterListLimit, setMasterListLimit] = useState(MASTER_TEXTBOOK_PAGE_SIZE);
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
  const [textbookDeleteDialogOpen, setTextbookDeleteDialogOpen] = useState(false);
  const [confirmationRequest, setConfirmationRequest] = useState<TextbookConfirmationRequest | null>(null);
  const [purchaseForm, setPurchaseForm] = useState(emptyPurchaseForm);
  const [purchaseDialogOpen, setPurchaseDialogOpen] = useState(false);
  const [purchaseRequestInputMode, setPurchaseRequestInputMode] = useState<"catalog" | "manual">("catalog");
  const [selectedPurchaseLineId, setSelectedPurchaseLineId] = useState("");
  const [selectedPurchaseScopeLineIds, setSelectedPurchaseScopeLineIds] = useState<Record<TextbookCopyScope, string>>({ student: "", teacher: "" });
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
  const [saleForm, setSaleForm] = useState(emptySaleForm);
  const [salesProcessFilter, setSalesProcessFilter] = useState<SalesProcessFilter>("all");
  const [selectedSaleLineIds, setSelectedSaleLineIds] = useState<string[]>([]);
  const [saleDialogOpen, setSaleDialogOpen] = useState(false);
  const [closingDialogOpen, setClosingDialogOpen] = useState(false);
  const [selectedClosingIds, setSelectedClosingIds] = useState<string[]>([]);
  const [selectedClosingDetailId, setSelectedClosingDetailId] = useState("");
  const [excludedStudentIds, setExcludedStudentIds] = useState<string[]>([]);
  const [saleStudentQuery, setSaleStudentQuery] = useState("");
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
  const currentUserEmail = normalizeEmailValue(user?.email);
  const canManageTextbookOperations = canManageAll || isAdmin || isStaff || role === "admin" || role === "staff";
  const canDeleteTextbookHistory =
    canManageAll ||
    isAdmin ||
    role === "admin" ||
    textbookHistoryDeleteAdminEmails.has(currentUserEmail);
  const activeTextbooks = useMemo(() => data.textbooks.filter(isActiveTextbook), [data.textbooks]);
  const activeInventory = useMemo(() => data.inventory.filter(isActiveTextbook), [data.inventory]);
  const inactiveTextbookRows = useMemo(() => data.inventory.filter((row) => !isActiveTextbook(row)), [data.inventory]);
  const inactiveTextbookTrashItems = useMemo(
    () => buildTextbookCleanupPreviewRows(inactiveTextbookRows),
    [inactiveTextbookRows],
  );
  const configuredPublisherOptions = useMemo(
    () => uniqueSortedLabels(data.publishers.map(getPublisherSettingLabel)),
    [data.publishers],
  );
  const publisherGroupOptions = useMemo(
    () => uniqueSortedLabels([
      ...configuredPublisherOptions,
      ...activeInventory.map(getKnownPublisherLabel),
    ]),
    [activeInventory, configuredPublisherOptions],
  );
  const masterPublisherOptions = useMemo(() => {
    const configuredPublisherKeys = new Set(configuredPublisherOptions.map((option) => option.toLowerCase()));
    const optionLabels = uniqueSortedLabels([
      ...publisherGroupOptions,
      masterForm.publisher,
    ]);

    return [
      { value: "none", label: "선택" },
      ...optionLabels.map((label) => ({
        value: label,
        label,
        description: configuredPublisherKeys.has(label.toLowerCase()) ? "설정" : "기존",
      })),
    ];
  }, [configuredPublisherOptions, masterForm.publisher, publisherGroupOptions]);
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
        ...activeInventory
          .filter((row) => subjectGroupFilter === "all" || normalizeSubjectValue(row.subject) === subjectGroupFilter)
          .map(getTextbookSubSubject),
      ]),
    ]
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, "ko")),
    [activeInventory, subjectGroupFilter, textbookSubSubjectSettings],
  );
  const duplicateTextbookTitleKeys = useMemo(() => {
    const titleCounts = new Map<string, number>();
    for (const row of activeInventory) {
      const key = getTextbookTitleKey(row);
      if (!key) continue;
      titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
    }
    return new Set([...titleCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  }, [activeInventory]);
  const textbookSearchIndexById = useMemo(
    () => new Map(data.inventory.map((row) => [getRecordId(row), buildTextbookSearchIndex(row)])),
    [data.inventory],
  );
  const activeTextbookQualityFilter = activeTab === "master" ? textbookQualityFilter : "all";
  const listFilteredInventory = useMemo(() => {
    const keyword = deferredQuery.trim().toLowerCase();
    const normalizedBarcodeQuery = normalizeBarcodeValue(keyword);

    return data.inventory.filter((row) => {
      if (subjectGroupFilter !== "all" && normalizeSubjectValue(row.subject) !== subjectGroupFilter) return false;
      if (schoolLevelGroupFilter !== "all" && getTextbookSchoolLevel(row) !== schoolLevelGroupFilter) return false;
      if (gradeLevelGroupFilter !== "all" && getTextbookGradeLevel(row) !== gradeLevelGroupFilter) return false;
      if (categoryGroupFilter !== "all" && getTextbookSubSubject(row) !== categoryGroupFilter) return false;
      if (!keyword) {
        return true;
      }
      const searchIndex = textbookSearchIndexById.get(getRecordId(row)) || buildTextbookSearchIndex(row);
      return searchIndex.haystack.includes(keyword) || (normalizedBarcodeQuery && searchIndex.barcodeText.includes(normalizedBarcodeQuery));
    }).filter((row) => matchesTextbookQualityFilter(row, activeTextbookQualityFilter, duplicateTextbookTitleKeys));
  }, [activeTextbookQualityFilter, categoryGroupFilter, data.inventory, deferredQuery, duplicateTextbookTitleKeys, gradeLevelGroupFilter, schoolLevelGroupFilter, subjectGroupFilter, textbookSearchIndexById]);
  const textbookQualityFilterCounts = useMemo(
    () => {
      const counts = Object.fromEntries(
        (Object.keys(textbookQualityFilterLabels) as TextbookQualityFilter[]).map((filter) => [filter, 0]),
      ) as Record<TextbookQualityFilter, number>;

      for (const row of data.inventory) {
        if (subjectGroupFilter !== "all" && normalizeSubjectValue(row.subject) !== subjectGroupFilter) continue;
        if (schoolLevelGroupFilter !== "all" && getTextbookSchoolLevel(row) !== schoolLevelGroupFilter) continue;
        if (gradeLevelGroupFilter !== "all" && getTextbookGradeLevel(row) !== gradeLevelGroupFilter) continue;
        if (categoryGroupFilter !== "all" && getTextbookSubSubject(row) !== categoryGroupFilter) continue;

        if (!isActiveTextbook(row)) {
          counts.inactive += 1;
          continue;
        }

        counts.all += 1;
        const issues = getTextbookQualityIssues(row, duplicateTextbookTitleKeys);
        let hasIssue = false;
        for (const filter of textbookQualityIssueFilterKeys) {
          if (filter === "inactive") continue;
          if (issues[filter]) {
            counts[filter] += 1;
            hasIssue = true;
          }
        }
        if (hasIssue) counts.attention += 1;
      }

      return counts;
    },
    [categoryGroupFilter, data.inventory, duplicateTextbookTitleKeys, gradeLevelGroupFilter, schoolLevelGroupFilter, subjectGroupFilter],
  );
  const inventoryFilterCounts = useMemo(
    () => {
      const counts = Object.fromEntries(
        (Object.keys(inventoryFilterLabels) as InventoryFilter[]).map((filter) => [filter, 0]),
      ) as Record<InventoryFilter, number>;

      for (const row of listFilteredInventory) {
        const totalQuantity = numberValue(row.totalQuantity);
        counts.all += 1;
        if (totalQuantity < 0) {
          counts.negative += 1;
          counts.shortage += 1;
        }
        if (totalQuantity === 0) counts.unused += 1;
        if (totalQuantity > 0 && totalQuantity <= INVENTORY_LOW_STOCK_THRESHOLD) counts.shortage += 1;
        if (totalQuantity >= 20) counts.surplus += 1;
      }

      return counts;
    },
    [listFilteredInventory],
  );
  const filteredInventory = useMemo(
    () => listFilteredInventory.filter((row) => matchesInventoryFilter(row, inventoryFilter)),
    [inventoryFilter, listFilteredInventory],
  );
  const masterVisibleInventory = useMemo(
    () => filteredInventory.slice(0, masterListLimit),
    [filteredInventory, masterListLimit],
  );
  const inventoryById = useMemo(
    () => new Map(data.inventory.map((row) => [getRecordId(row), row])),
    [data.inventory],
  );
  const visibleTextbookIds = useMemo(
    () => masterVisibleInventory.map(getRecordId).filter(Boolean),
    [masterVisibleInventory],
  );
  const visibleTextbookIdSet = useMemo(() => new Set(visibleTextbookIds), [visibleTextbookIds]);
  const selectedTextbookIdSet = useMemo(() => new Set(selectedTextbookIds), [selectedTextbookIds]);
  const selectedTextbookRows = useMemo(
    () => selectedTextbookIds
      .map((id) => inventoryById.get(id))
      .filter((row): row is Row => Boolean(row)),
    [inventoryById, selectedTextbookIds],
  );
  const selectedTextbookCleanupRows = useMemo(
    () => buildTextbookCleanupPreviewRows(selectedTextbookRows),
    [selectedTextbookRows],
  );
  const selectedTextbookCleanupPreviewRows = selectedTextbookCleanupRows.slice(0, 5);
  const selectedTextbookCleanupMoreCount = Math.max(0, selectedTextbookCleanupRows.length - selectedTextbookCleanupPreviewRows.length);
  const selectedVisibleTextbookCount = useMemo(
    () => visibleTextbookIds.filter((id) => selectedTextbookIdSet.has(id)).length,
    [selectedTextbookIdSet, visibleTextbookIds],
  );
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
  const textbookListFilterCount = [
    query,
    inventoryFilter !== "all" ? inventoryFilter : "",
    activeTextbookQualityFilter !== "all" ? activeTextbookQualityFilter : "",
    subjectGroupFilter !== "all" ? subjectGroupFilter : "",
    schoolLevelGroupFilter !== "all" ? schoolLevelGroupFilter : "",
    gradeLevelGroupFilter !== "all" ? gradeLevelGroupFilter : "",
    categoryGroupFilter !== "all" ? categoryGroupFilter : "",
  ].filter(Boolean).length;
  const textbookEmptyLabel = hasTextbookListFilter ? "조건에 맞는 교재가 없습니다" : "교재가 없습니다";
  const hasMoreMasterTextbooks = filteredInventory.length > masterVisibleInventory.length;
  const remainingMasterTextbookCount = Math.max(0, filteredInventory.length - masterVisibleInventory.length);
  const masterVisibleSummary = hasMoreMasterTextbooks
    ? `${formatQuantity(masterVisibleInventory.length)}/${formatQuantity(filteredInventory.length)}종`
    : `${formatQuantity(filteredInventory.length)}종`;

  useEffect(() => {
    const availableIds = new Set(filteredInventory.map(getRecordId).filter(Boolean));
    setSelectedTextbookIds((current) => {
      const next = current.filter((id) => availableIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [filteredInventory]);

  useEffect(() => {
    setMasterListLimit(MASTER_TEXTBOOK_PAGE_SIZE);
  }, [
    activeTextbookQualityFilter,
    categoryGroupFilter,
    gradeLevelGroupFilter,
    inventoryFilter,
    query,
    schoolLevelGroupFilter,
    subjectGroupFilter,
  ]);
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

    return activeInventory.filter((row) => {
      if (getRecordId(row) === masterForm.id) return false;
      if (getTextbookTitle(row).trim().toLowerCase() !== currentTitle) return false;
      if (normalizeSubjectValue(row.subject) !== masterForm.subject) return false;
      if (currentPublisher && getPublisherLabel(row).trim().toLowerCase() !== currentPublisher) return false;
      if (currentCategory && getCategoryLabel(row).trim().toLowerCase() !== currentCategory) return false;
      return true;
    });
  }, [
    activeInventory,
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
    setSelectedTextbookIds((current) => current.filter((id) => visibleTextbookIdSet.has(id)));
  }, [visibleTextbookIdSet]);

  useEffect(() => {
    const existingIds = new Set(data.purchaseOrderLines.map(getRecordId).filter(Boolean));
    setSelectedPurchaseLineIds((current) => current.filter((id) => existingIds.has(id)));
  }, [data.purchaseOrderLines]);

  useEffect(() => {
    const existingIds = new Set(data.saleLines.map(getRecordId).filter(Boolean));
    setSelectedSaleLineIds((current) => current.filter((id) => existingIds.has(id)));
  }, [data.saleLines]);

  useEffect(() => {
    const existingIds = new Set(data.monthlyClosings.map(getRecordId).filter(Boolean));
    setSelectedClosingIds((current) => current.filter((id) => existingIds.has(id)));
  }, [data.monthlyClosings]);

  useEffect(() => {
    if (!canManageTextbookOperations && activeTab !== "requests") {
      setActiveTab("requests");
      updateOperationSearchQuery("");
      setSelectedPurchaseLineIds([]);
      setSelectedSaleLineIds([]);
      setSelectedTextbookIds([]);
      setSelectedClosingIds([]);
    }
  }, [activeTab, canManageTextbookOperations]);

  useEffect(() => {
    const validDraftKeys = new Set(
      data.inventory.flatMap((row) => {
        if (!isActiveTextbook(row)) return [];
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

  const purchaseOrdersById = useMemo(
    () => new Map(data.purchaseOrders.map((order) => [getRecordId(order), order])),
    [data.purchaseOrders],
  );
  const activePurchaseOrderLines = useMemo(
    () => data.purchaseOrderLines.filter((line) => shouldShowOperationalPurchaseLine(line, getPurchaseLineOrder(line, purchaseOrdersById), data.textbooks)),
    [data.purchaseOrderLines, data.textbooks, purchaseOrdersById],
  );
  const activeSaleLines = useMemo(
    () => data.saleLines.filter((line) => shouldShowOperationalSaleLine(line, data.textbooks)),
    [data.saleLines, data.textbooks],
  );
  const activeTextbookIdSet = useMemo(
    () => new Set(activeTextbooks.map(getRecordId).filter(Boolean)),
    [activeTextbooks],
  );
  const activeStockMoves = useMemo(
    () => data.stockMoves.filter((move) => activeTextbookIdSet.has(text(move.textbook_id || move.textbookId))),
    [activeTextbookIdSet, data.stockMoves],
  );
  const activeStockCounts = useMemo(
    () => data.stockCounts.filter((count) => activeTextbookIdSet.has(text(count.textbook_id || count.textbookId))),
    [activeTextbookIdSet, data.stockCounts],
  );
  const purchaseLinesById = useMemo(
    () => new Map(data.purchaseOrderLines.map((line) => [getRecordId(line), line])),
    [data.purchaseOrderLines],
  );
  const saleLinesById = useMemo(
    () => new Map(data.saleLines.map((line) => [getRecordId(line), line])),
    [data.saleLines],
  );
  const selectedBulkOrderLines = useMemo(
    () => selectedPurchaseLineIds
      .map((id) => purchaseLinesById.get(id))
      .filter((line): line is Row => {
        if (!line) return false;
        const order = getPurchaseLineOrder(line, purchaseOrdersById);
        if (text(line.status || order?.status) !== "requested") return false;
        return isOrderablePurchaseRequestLine(line, order, data.textbooks);
      }),
    [data.textbooks, purchaseLinesById, purchaseOrdersById, selectedPurchaseLineIds],
  );
  const selectedReceivablePurchaseLines = useMemo(
    () => selectedPurchaseLineIds
      .map((id) => purchaseLinesById.get(id))
      .filter((line): line is Row => {
        if (!line) return false;
        const order = getPurchaseLineOrder(line, purchaseOrdersById);
        const status = text(line.status || order?.status);
        return status === "ordered" || status === "partially_received";
      }),
    [purchaseLinesById, purchaseOrdersById, selectedPurchaseLineIds],
  );
  const selectedReturnablePurchaseLines = useMemo(
    () => selectedPurchaseLineIds
      .map((id) => purchaseLinesById.get(id))
      .filter((line): line is Row => {
        if (!line) return false;
        const order = getPurchaseLineOrder(line, purchaseOrdersById);
        const status = text(line.status || order?.status);
        const received = numberValue(line.received_quantity || line.receivedQuantity);
        return received > 0 && status !== "returned" && status !== "cancelled";
      }),
    [purchaseLinesById, purchaseOrdersById, selectedPurchaseLineIds],
  );
  const selectedIssuableSaleLines = useMemo(
    () => selectedSaleLineIds
      .map((id) => saleLinesById.get(id))
      .filter((line): line is Row => {
        if (!line) return false;
        const status = text(line.status) || "charged";
        return status !== "issued" && status !== "cancelled" && status !== "returned";
      }),
    [saleLinesById, selectedSaleLineIds],
  );
  const selectedCancelableSaleLines = useMemo(
    () => selectedSaleLineIds
      .map((id) => saleLinesById.get(id))
      .filter((line): line is Row => {
        if (!line) return false;
        const status = text(line.status) || "charged";
        return status !== "issued" && status !== "cancelled" && status !== "returned";
      }),
    [saleLinesById, selectedSaleLineIds],
  );
  const selectedReturnableSaleLines = useMemo(
    () => selectedSaleLineIds
      .map((id) => saleLinesById.get(id))
      .filter((line): line is Row => {
        if (!line) return false;
        return text(line.status) === "issued";
      }),
    [saleLinesById, selectedSaleLineIds],
  );
  const selectedDeletableSaleLines = useMemo(
    () => selectedSaleLineIds
      .map((id) => saleLinesById.get(id))
      .filter((line): line is Row => Boolean(line)),
    [saleLinesById, selectedSaleLineIds],
  );
  const purchaseFieldVisibility = getPurchaseFieldVisibility(purchaseForm.requestStage);
  const explicitlySelectedPurchaseTextbook = getTextbookById(data.textbooks, purchaseForm.textbookId);
  const explicitPurchaseTextbookId = getRecordId(explicitlySelectedPurchaseTextbook || {});
  const purchaseRequestTitle = text(purchaseForm.requestedTextbookTitle || getTextbookTitle(explicitlySelectedPurchaseTextbook || {}) || purchaseForm.textbookId);
  const requestedCatalogTextbook = getTextbookById(activeTextbooks, purchaseRequestTitle);
  const selectedPurchaseTextbook = explicitlySelectedPurchaseTextbook || requestedCatalogTextbook;
  const selectedPurchaseTextbookId = getRecordId(selectedPurchaseTextbook || {});
  const purchaseRequestUsesCatalog = purchaseRequestInputMode === "catalog";
  const manualPurchaseCatalogMatches = useMemo(
    () => {
      if (purchaseRequestInputMode !== "manual") return [];
      const textbook = getTextbookById(activeTextbooks, purchaseRequestTitle);
      return textbook ? [textbook] : [];
    },
    [activeTextbooks, purchaseRequestInputMode, purchaseRequestTitle],
  );
  const hasManualPurchaseCatalogMatch = manualPurchaseCatalogMatches.length > 0;
  const configuredPurchaseSupplierId =
    getConfiguredSupplierIdForTextbook(selectedPurchaseTextbook, data.publisherSupplierLinks, data.publishers) || purchaseForm.supplierId;
  const purchaseCopyScope = getTextbookCopyScope(purchaseForm);
  const configuredPurchaseUnitCost = getConfiguredTextbookPurchaseUnitCost(
    selectedPurchaseTextbook,
    configuredPurchaseSupplierId,
    data.suppliers,
    purchaseForm.unitCost,
    purchaseCopyScope,
  );
  const configuredPurchaseSupplierLabel = configuredPurchaseSupplierId
    ? getSupplierName(data.suppliers, configuredPurchaseSupplierId)
    : "-";
  const selectedPurchaseClass = getClassById(data.classes, purchaseForm.classId);
  const purchaseClassStudentCount = getClassStudentCount(selectedPurchaseClass, data.students);
  const purchaseStudentRequestedQuantity = numberValue(getPurchaseScopeQuantity(purchaseForm, "student", "requested"));
  const purchaseTeacherRequestedQuantity = numberValue(getPurchaseScopeQuantity(purchaseForm, "teacher", "requested"));
  const purchaseRequestedTotalQuantity = purchaseStudentRequestedQuantity + purchaseTeacherRequestedQuantity;
  const purchaseRequestedScopeSummary = formatPurchaseScopeQuantityMetric(purchaseStudentRequestedQuantity, purchaseTeacherRequestedQuantity);
  const purchaseStudentOrderedQuantity = numberValue(getPurchaseScopeQuantity(purchaseForm, "student", "ordered"));
  const purchaseTeacherOrderedQuantity = numberValue(getPurchaseScopeQuantity(purchaseForm, "teacher", "ordered"));
  const purchaseOrderedTotalQuantity = purchaseStudentOrderedQuantity + purchaseTeacherOrderedQuantity;
  const purchaseStudentReceivedQuantity = numberValue(getPurchaseScopeQuantity(purchaseForm, "student", "received"));
  const purchaseTeacherReceivedQuantity = numberValue(getPurchaseScopeQuantity(purchaseForm, "teacher", "received"));
  const purchaseReceivedTotalQuantity = purchaseStudentReceivedQuantity + purchaseTeacherReceivedQuantity;
  const purchaseQuantityFit = getPurchaseQuantityClassFit(String(purchaseStudentRequestedQuantity), purchaseClassStudentCount);
  const selectedPurchaseInventory = inventoryById.get(selectedPurchaseTextbookId || purchaseForm.textbookId);
  const purchaseCurrentLocationQuantity = getInventoryQuantity(selectedPurchaseInventory, selectedLocationId);
  const purchaseProjectedLocationQuantity = purchaseForm.requestStage === "receive"
    ? purchaseCurrentLocationQuantity + purchaseReceivedTotalQuantity
    : purchaseCurrentLocationQuantity;
  const configuredPurchaseStudentUnitCost = getConfiguredTextbookPurchaseUnitCost(
    selectedPurchaseTextbook,
    configuredPurchaseSupplierId,
    data.suppliers,
    purchaseForm.unitCost,
    "student",
  );
  const configuredPurchaseTotalCost = configuredPurchaseStudentUnitCost * (
    purchaseForm.requestStage === "receive"
      ? purchaseStudentReceivedQuantity
      : purchaseForm.requestStage === "order"
        ? purchaseStudentOrderedQuantity
        : purchaseStudentRequestedQuantity
  );
  const selectedClassId = saleForm.classId;
  const saleCopyScope = getTextbookCopyScope(saleForm);
  const isTeacherSale = saleCopyScope === "teacher";
  const selectedSaleClass = getClassById(data.classes, selectedClassId);
  const selectedSaleTextbook = getTextbookById(data.textbooks, saleForm.textbookId);
  const selectedSaleInventory = inventoryById.get(saleForm.textbookId);
  const saleAvailableQuantity = getInventoryQuantity(selectedSaleInventory, saleLocationId);
  const saleTeacherName = text(saleForm.teacherName);
  const saleTeacherQuantity = Math.max(1, numberValue(saleForm.quantity) || 1);
  const selectedClassStudents = getStudentsByClass(selectedSaleClass, data.students);
  const normalizedSaleChargeMonth = normalizeMonthInput(saleForm.chargeMonth);
  const saleStudentSearchQuery = normalizeStoredTextInput(saleStudentQuery).toLowerCase();
  const visibleSaleStudents = useMemo(
    () => {
      if (!saleStudentSearchQuery) return selectedClassStudents;
      return selectedClassStudents.filter((student) =>
        [
          getStudentName(student),
          getStudentGradeLabel(student),
          text(student.school || student.school_name || student.schoolName),
        ].join(" ").toLowerCase().includes(saleStudentSearchQuery),
      );
    },
    [saleStudentSearchQuery, selectedClassStudents],
  );
  const saleDuplicateLines = useMemo(
    () => {
      if (isTeacherSale || !selectedClassId || !saleForm.textbookId || !normalizedSaleChargeMonth) return [];
      const salesById = new Map(data.sales.map((sale) => [getRecordId(sale), sale]));
      return activeSaleLines.filter((line) => {
        if (getTextbookCopyScope(line) === "teacher") return false;
        const sale = salesById.get(text(line.sale_id || line.saleId));
        const status = getSaleLineStatus(line, sale);
        if (!isBillableSaleLineStatus(status)) return false;
        return text(line.class_id || line.classId || sale?.class_id || sale?.classId) === selectedClassId &&
          text(line.textbook_id || line.textbookId) === saleForm.textbookId &&
          getSaleLineMonth(line, sale) === normalizedSaleChargeMonth;
      });
    },
    [activeSaleLines, data.sales, isTeacherSale, normalizedSaleChargeMonth, saleForm.textbookId, selectedClassId],
  );
  const saleDuplicateStudentCount = useMemo(
    () => new Set(saleDuplicateLines.map((line) => text(line.student_id || line.studentId)).filter(Boolean)).size || saleDuplicateLines.length,
    [saleDuplicateLines],
  );
  const saleDraft = isTeacherSale
    ? selectedSaleTextbook
      ? buildTeacherTextbookIssueDraft({
          textbook: selectedSaleTextbook,
          teacherName: saleTeacherName,
          quantity: saleTeacherQuantity,
          chargeMonth: normalizedSaleChargeMonth,
          locationId: saleLocationId,
          availableQuantity: saleAvailableQuantity,
        })
      : { lines: [], totalAmount: 0, totalQuantity: 0, availableQuantity: saleAvailableQuantity, stockShortage: 0, hasStockShortage: false }
    : selectedSaleClass && selectedSaleTextbook
      ? buildTextbookSaleDraft({
          classRecord: selectedSaleClass,
          students: selectedClassStudents,
          textbook: selectedSaleTextbook,
          chargeMonth: normalizedSaleChargeMonth,
          excludedStudentIds,
          locationId: saleLocationId,
          availableQuantity: saleAvailableQuantity,
        })
      : { lines: [], totalAmount: 0, totalQuantity: 0, availableQuantity: saleAvailableQuantity, stockShortage: 0, hasStockShortage: false };
  const saleSubmitDisabled = isTeacherSale
    ? !selectedSaleTextbook || !saleTeacherName || saleTeacherQuantity <= 0
    : !selectedSaleClass ||
      !selectedSaleTextbook ||
      saleDraft.lines.length === 0 ||
      saleDuplicateLines.length > 0;
  const saleSubmitHint = !selectedSaleClass ? "수업을 선택하세요" : !selectedSaleTextbook ? "교재를 선택하세요" : saleDraft.lines.length === 0
    ? "출고 대상 학생이 없습니다"
    : saleDuplicateLines.length > 0
      ? "이미 같은 월 출고가 있습니다"
      : "출고 대기 저장";
  const teacherSaleSubmitHint = !selectedSaleTextbook
    ? "교재를 선택하세요"
    : !saleTeacherName
      ? "선생님을 선택하세요"
      : "교사용 출고 대기 저장";
  const effectiveSaleSubmitHint = isTeacherSale ? teacherSaleSubmitHint : saleSubmitHint;
  const selectedSaleStudentCount = selectedClassStudents.length;
  const includedSaleStudentCount = selectedClassStudents
    .filter((student) => !excludedStudentIds.includes(getRecordId(student)))
    .length;
  const excludedSaleStudentCount = Math.max(0, selectedSaleStudentCount - includedSaleStudentCount);
  const visibleSaleStudentCount = visibleSaleStudents.length;
  const visibleIncludedSaleStudentCount = visibleSaleStudents
    .filter((student) => !excludedStudentIds.includes(getRecordId(student)))
    .length;
  const saleProjectedAmount = saleDraft.totalAmount;
  const saleProjectedEndingQuantity = saleDraft.availableQuantity - saleDraft.totalQuantity;
  const operationMetrics = useMemo(() => buildTextbookOpsMetrics(data), [data]);
  const operationQueueTotal =
    operationMetrics.unregisteredRequestCount +
    operationMetrics.orderNeededCount +
    operationMetrics.partialReceiptCount +
    operationMetrics.issueWaitingCount +
    operationMetrics.stockRiskCount;
  const showsInventoryTools = activeTab === "master" || activeTab === "inventory";
  const activeProcessHasRows =
    activeTab === "requests" ? operationMetrics.requestCount > 0 :
    activeTab === "purchase" ? activePurchaseOrderLines.length > 0 :
    activeTab === "sales" ? activeSaleLines.length > 0 :
    false;
  const showsProcessSearch = activeProcessHasRows || Boolean(text(operationQuery));
  const showsProcessCommandCenter =
    canManageTextbookOperations &&
    activeTab !== "requests" &&
    operationQueueTotal > 0 &&
    (activeTab === "purchase" || activeTab === "sales");
  const showsProcessToolbar =
    (activeTab === "requests" ||
      activeTab === "purchase" ||
      activeTab === "sales") &&
    (showsProcessSearch || showsProcessCommandCenter);
  const activeOperationSearchQuery = text(operationQuery);
  const activeWorkflowSelectionCount =
    activeTab === "purchase" || activeTab === "requests" ? selectedPurchaseLineIds.length :
    activeTab === "sales" ? selectedSaleLineIds.length :
    activeTab === "closing" ? selectedClosingIds.length :
    selectedTextbookRows.length;
  const operationSearchLabel = getOperationSearchLabel(activeTab);
  const operationSearchPlaceholder = getOperationSearchPlaceholder(activeTab);
  const activeQueueKey: TextbookOpsQueueKey | "" =
    activeTab === "purchase" && purchaseRequestFilter === "unregistered" ? "unregistered" :
    activeTab === "purchase" && purchaseOrderFilter === "waiting" ? "order" :
    activeTab === "purchase" && purchaseOrderFilter === "partial" ? "partial" :
    activeTab === "sales" && salesProcessFilter === "waiting" ? "issue" :
    activeTab === "inventory" && inventoryFilter === "shortage" ? "stockRisk" :
    "";
  const activeTabResultCount =
    activeTab === "master" || activeTab === "inventory" ? filteredInventory.length :
    activeTab === "requests" ? operationMetrics.requestCount :
    activeTab === "purchase" ? activePurchaseOrderLines.length :
    activeTab === "sales" ? activeSaleLines.length :
    data.monthlyClosings.length;
  const workspaceStatusItems: TextbookOperationsStatusItem[] = [
    { id: "result", label: "표시", value: `${formatQuantity(activeTabResultCount)}건` },
    { id: "filters", label: "필터", value: `${formatQuantity(textbookListFilterCount)}개`, hidden: textbookListFilterCount <= 0 },
    { id: "selection", label: "선택", value: `${formatQuantity(activeWorkflowSelectionCount)}건`, hidden: activeWorkflowSelectionCount <= 0 },
    { id: "search", label: "검색", value: activeTab === "master" || activeTab === "inventory" ? query : activeOperationSearchQuery, hidden: !(activeTab === "master" || activeTab === "inventory" ? text(query) : activeOperationSearchQuery) },
    { id: "schema", label: "DB", value: "확인 필요", tone: "danger" as const, hidden: !schemaDisabled },
  ].filter((item) => !item.hidden);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (document.activeElement === masterSearchRef.current && query) {
          event.preventDefault();
          setQuery("");
          setSelectedTextbookIds([]);
          setBulkTextbookPatch(emptyBulkTextbookPatch);
          setMasterListLimit(MASTER_TEXTBOOK_PAGE_SIZE);
          return;
        }
        if (document.activeElement === operationSearchRef.current && operationQuery) {
          event.preventDefault();
          updateOperationSearchQuery("");
        }
        return;
      }

      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || isEditableShortcutTarget(event.target)) {
        return;
      }

      const target = activeTab === "requests" || activeTab === "purchase" || activeTab === "sales"
        ? operationSearchRef.current
        : masterSearchRef.current;
      if (!target) return;
      event.preventDefault();
      target.focus();
    };

    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, [activeTab, operationQuery, query, showsProcessToolbar]);

  const masterGradeOptions = getGradeOptionsForSchoolLevel(masterForm.schoolLevel);
  const masterSubSubjectOptions = getSubSubjectOptionsForSubject(textbookSubSubjectSettings, masterForm.subject);
  const masterTitleValue = text(masterForm.title);
  const masterDuplicatePreviewRows = masterDuplicateRows.slice(0, 3);
  const isNewMasterDuplicate = !masterForm.id && masterDuplicateRows.length > 0;
  const bulkGradeOptions = getGradeOptionsForSchoolLevel(
    bulkTextbookPatch.schoolLevel === "keep" || bulkTextbookPatch.schoolLevel === "none" ? "" : bulkTextbookPatch.schoolLevel,
  );
  const bulkCategoryOptions = [
    ...new Set([
      ...(bulkTextbookPatch.subject === "keep"
        ? categoryGroupOptions
        : getSubSubjectOptionsForSubject(textbookSubSubjectSettings, bulkTextbookPatch.subject)),
      ...categoryGroupOptions,
    ]),
  ]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "ko", { numeric: true }));
  const masterSubmitDisabled = saving === "master" || !masterTitleValue || isNewMasterDuplicate;
  const purchaseSubmitDisabled = schemaDisabled ||
    saving === "purchase" ||
    (purchaseForm.requestStage === "request" && !purchaseRequestTitle) ||
    (purchaseForm.requestStage !== "request" && !selectedPurchaseTextbookId) ||
    (purchaseForm.requestStage === "request" && !purchaseRequestedTotalQuantity && !selectedPurchaseLineId) ||
    (purchaseForm.requestStage !== "request" && !purchaseOrderedTotalQuantity) ||
    (purchaseForm.requestStage === "receive" && !purchaseReceivedTotalQuantity);
  const filteredClosingMoves = filterStockMovesForClosing({
    closingMonth: closingForm.closingMonth,
    subject: closingForm.subject,
    textbooks: data.textbooks,
    publishers: data.publishers,
    suppliers: data.suppliers,
    publisherSupplierLinks: data.publisherSupplierLinks,
    stockMoves: data.stockMoves,
  });
  const closingPreview = buildTextbookMonthlyClosing({
    openingQuantity: numberValue(closingForm.openingQuantity),
    openingAmount: numberValue(closingForm.openingAmount),
    stockMoves: filteredClosingMoves,
  });
  const closingNeedsMemo = closingPreview.needsReview && !text(closingForm.memo);
  const closingTeamMarginMetrics = ((closingPreview.teamMargins || []) as Array<{ team: string; marginAmount: number; saleQuantity: number }>)
    .filter((item) => item.team === "english" || item.team === "math")
    .filter((item) => closingForm.subject === "all" || item.team === closingForm.subject);
  const closingTargetSubjects = closingForm.subject === "all" ? ["all", "english", "math"] : [closingForm.subject];
  const selectedClosingDetail = data.monthlyClosings.find((row) => getRecordId(row) === selectedClosingDetailId);

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

      if (name === "copyScope") {
        return {
          ...current,
          copyScope: getTextbookCopyScope({ copyScope: value }),
        };
      }

      if (name === "requestedTextbookTitle") {
        return { ...current, requestedTextbookTitle: normalizeInlineTextInput(value) };
      }

      if (isPurchaseQuantityField(name)) {
        return {
          ...current,
          [name]: normalizePurchaseQuantityField(name, value),
        };
      }

      if (name === "requestedQuantity" || name === "orderedQuantity" || name === "receivedQuantity") {
        const normalized = normalizeQuantityInput(value, { allowZero: name === "receivedQuantity" });
        const prefix = getTextbookCopyScope(current) === "teacher" ? "teacher" : "student";
        const dualFieldName = `${prefix}${name[0].toUpperCase()}${name.slice(1)}` as keyof typeof emptyPurchaseForm;
        return {
          ...current,
          [name]: normalized,
          [dualFieldName]: normalized,
        };
      }

      if (name === "unitCost") {
        return { ...current, unitCost: normalizeMoneyInput(value) };
      }

      if (name === "statementNumber") {
        return { ...current, statementNumber: normalizeInlineTextInput(value) };
      }

      if (name !== "requestStage") {
        return { ...current, [name]: value };
      }

      const studentRequestedQuantity = normalizePurchaseQuantityField("studentRequestedQuantity", current.studentRequestedQuantity) || "1";
      const teacherRequestedQuantity = normalizePurchaseQuantityField("teacherRequestedQuantity", current.teacherRequestedQuantity);
      const studentOrderedQuantity = normalizePurchaseQuantityField("studentOrderedQuantity", current.studentOrderedQuantity) || studentRequestedQuantity;
      const teacherOrderedQuantity = normalizePurchaseQuantityField("teacherOrderedQuantity", current.teacherOrderedQuantity) || teacherRequestedQuantity;
      const requestedQuantity = getTextbookCopyScope(current) === "teacher" ? teacherRequestedQuantity || "1" : studentRequestedQuantity || "1";
      const orderedQuantity = getTextbookCopyScope(current) === "teacher" ? teacherOrderedQuantity || requestedQuantity : studentOrderedQuantity || requestedQuantity;
      return {
        ...current,
        requestStage: value,
        requestedQuantity,
        orderedQuantity: value === "request" ? "" : orderedQuantity,
        receivedQuantity: value === "receive"
          ? normalizeQuantityInput(current.receivedQuantity) || orderedQuantity
          : "",
        studentRequestedQuantity,
        teacherRequestedQuantity,
        studentOrderedQuantity: value === "request" ? "" : studentOrderedQuantity,
        teacherOrderedQuantity: value === "request" ? "" : teacherOrderedQuantity,
        studentReceivedQuantity: value === "receive"
          ? normalizePurchaseQuantityField("studentReceivedQuantity", current.studentReceivedQuantity) || studentOrderedQuantity
          : "",
        teacherReceivedQuantity: value === "receive"
          ? normalizePurchaseQuantityField("teacherReceivedQuantity", current.teacherReceivedQuantity) || teacherOrderedQuantity
          : "",
      };
    });
  }

  function settlePurchaseTextField(name: "requestedTextbookTitle" | "statementNumber") {
    setPurchaseForm((current) => ({ ...current, [name]: normalizeStoredTextInput(current[name]) }));
  }

  function selectCatalogTextbookForPurchaseRequest(row: Row) {
    setPurchaseRequestInputMode("catalog");
    setPurchaseField("textbookId", getRecordId(row));
  }

  function setSaleField(name: string, value: string) {
    setSaleForm((current) => {
      if (name === "copyScope") {
        return {
          ...current,
          copyScope: getTextbookCopyScope({ copyScope: value }),
          classId: value === "teacher" ? "" : current.classId,
          teacherName: value === "teacher" ? current.teacherName : "",
          quantity: value === "teacher" ? current.quantity || "1" : "1",
        };
      }
      if (name === "chargeMonth") {
        return { ...current, chargeMonth: normalizeMonthInput(value, currentMonth()) };
      }
      if (name === "teacherName") {
        return { ...current, teacherName: value };
      }
      if (name === "quantity") {
        return { ...current, quantity: normalizeQuantityInput(value) || "" };
      }
      if (name === "memo") {
        return { ...current, memo: normalizeInlineTextInput(value) };
      }
      return { ...current, [name]: value };
    });
  }

  function settleSaleMemo() {
    setSaleForm((current) => ({ ...current, memo: normalizeStoredTextInput(current.memo) }));
  }

  function updateOperationSearchQuery(value: string) {
    setOperationQuery(value);
    setSelectedPurchaseLineIds([]);
    setSelectedSaleLineIds([]);
  }

  function refreshTextbookData() {
    setMessage("");
    setActionErrorMessage("");
    void refresh();
  }

  function setMasterTextField(name: "title" | "publisher", value: string) {
    setMasterForm((current) => ({ ...current, [name]: normalizeInlineTextInput(value) }));
  }

  function settleMasterTextField(name: "title" | "publisher") {
    setMasterForm((current) => ({ ...current, [name]: normalizeStoredTextInput(current[name]) }));
  }

  function setMasterIsbn13(value: string) {
    const nextIsbn = normalizeBarcodeValue(value);
    setMasterForm((current) => {
      const previousIsbn = normalizeBarcodeValue(current.isbn13);
      const previousBarcode = normalizeBarcodeValue(current.barcode);
      const shouldMirrorBarcode = !previousBarcode || previousBarcode === previousIsbn;
      return {
        ...current,
        isbn13: nextIsbn,
        barcode: shouldMirrorBarcode ? nextIsbn : previousBarcode,
      };
    });
  }

  function openDuplicateMaster(row: Row) {
    selectMasterTextbook(row);
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
    setSelectedPurchaseScopeLineIds({ student: "", teacher: "" });
    setPurchaseForm(emptyPurchaseForm);
    setPurchaseRequestInputMode("catalog");
    setMessage("");
  }

  function resetSaleForm() {
    setSaleForm({ ...emptySaleForm, chargeMonth: currentMonth() });
    setExcludedStudentIds([]);
    setSaleStudentQuery("");
  }

  function openNewPurchaseDialog() {
    setSelectedPurchaseLineId("");
    setSelectedPurchaseScopeLineIds({ student: "", teacher: "" });
    setPurchaseForm({ ...emptyPurchaseForm, requestStage: "order" });
    setPurchaseRequestInputMode("catalog");
    setMessage("");
    setPurchaseDialogOpen(true);
  }

  function openNewRequestDialog() {
    setSelectedPurchaseLineId("");
    setSelectedPurchaseScopeLineIds({ student: "", teacher: "" });
    setPurchaseForm({ ...emptyPurchaseForm, requestStage: "request" });
    setPurchaseRequestInputMode("catalog");
    setMessage("");
    setPurchaseDialogOpen(true);
  }

  function openNewSaleDialog() {
    resetSaleForm();
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
    setMasterForm(emptyMasterForm);
    setMessage("");
    window.setTimeout(() => setMasterDialogOpen(false), 0);
  }

  function closePurchaseDialog() {
    setPurchaseDialogOpen(false);
    resetPurchaseForm();
    window.setTimeout(() => setPurchaseDialogOpen(false), 0);
  }

  function closeSaleDialog() {
    setSaleDialogOpen(false);
    resetSaleForm();
    setMessage("");
    window.setTimeout(() => setSaleDialogOpen(false), 0);
  }

  function closeClosingDialog() {
    setClosingDialogOpen(false);
    setMessage("");
    window.setTimeout(() => setClosingDialogOpen(false), 0);
  }

  function clearMasterSelection() {
    setSelectedTextbookIds([]);
    setBulkTextbookPatch(emptyBulkTextbookPatch);
  }

  function clearTransientTextbookFeedback() {
    setMessage("");
    setActionErrorMessage("");
  }

  function updateMasterSearchQuery(value: string) {
    clearTransientTextbookFeedback();
    setQuery(value);
    clearMasterSelection();
    setMasterListLimit(MASTER_TEXTBOOK_PAGE_SIZE);
  }

  function changeInventoryFilter(value: InventoryFilter) {
    clearTransientTextbookFeedback();
    setInventoryFilter(value);
    clearMasterSelection();
    setMasterListLimit(MASTER_TEXTBOOK_PAGE_SIZE);
  }

  function changeTextbookQualityFilter(value: TextbookQualityFilter) {
    clearTransientTextbookFeedback();
    setTextbookQualityFilter(value);
    clearMasterSelection();
    setMasterListLimit(MASTER_TEXTBOOK_PAGE_SIZE);
  }

  function changeSubjectGroupFilter(value: string) {
    clearTransientTextbookFeedback();
    setSubjectGroupFilter(value);
    setCategoryGroupFilter("all");
    clearMasterSelection();
    setMasterListLimit(MASTER_TEXTBOOK_PAGE_SIZE);
  }

  function changeSchoolLevelGroupFilter(value: string) {
    clearTransientTextbookFeedback();
    setSchoolLevelGroupFilter(value);
    setGradeLevelGroupFilter("all");
    clearMasterSelection();
    setMasterListLimit(MASTER_TEXTBOOK_PAGE_SIZE);
  }

  function changeGradeLevelGroupFilter(value: string) {
    clearTransientTextbookFeedback();
    setGradeLevelGroupFilter(value);
    clearMasterSelection();
    setMasterListLimit(MASTER_TEXTBOOK_PAGE_SIZE);
  }

  function changeCategoryGroupFilter(value: string) {
    clearTransientTextbookFeedback();
    setCategoryGroupFilter(value);
    clearMasterSelection();
    setMasterListLimit(MASTER_TEXTBOOK_PAGE_SIZE);
  }

  function requestTextbookConfirmation(request: TextbookConfirmationRequest) {
    setConfirmationRequest(request);
  }

  function confirmTextbookAction() {
    const request = confirmationRequest;
    setConfirmationRequest(null);
    request?.onConfirm();
  }

  function changeActiveTab(value: string) {
    if (!canManageTextbookOperations && value !== "requests") {
      setActiveTab("requests");
      setMessage("");
      setActionErrorMessage("");
      return;
    }

    if (value !== activeTab) {
      clearMasterSelection();
      setSelectedPurchaseLineIds([]);
      setSelectedSaleLineIds([]);
      setSelectedClosingIds([]);
    }
    setActiveTab(value);
    setMessage("");
    setActionErrorMessage("");
    if (value !== "requests" && value !== "purchase" && value !== "sales") {
      updateOperationSearchQuery("");
    }
    if (value !== "purchase") {
      setPurchaseRequestFilter("all");
    }
    if (value !== "purchase") {
      setPurchaseOrderFilter("all");
    }
    if (value !== "sales") {
      setSalesProcessFilter("all");
    }
  }

  function clearTextbookListFilters(nextQuery = "") {
    updateMasterSearchQuery(nextQuery);
    setInventoryFilter("all");
    setTextbookQualityFilter("all");
    setSubjectGroupFilter("all");
    setSchoolLevelGroupFilter("all");
    setGradeLevelGroupFilter("all");
    setCategoryGroupFilter("all");
    setCollapsedTextbookGroups([]);
    clearMasterSelection();
    setMasterListLimit(MASTER_TEXTBOOK_PAGE_SIZE);
  }

  function resetTextbookListFilters() {
    clearTextbookListFilters("");
  }

  function showSavedMasterTextbook(title: string) {
    setActiveTab("master");
    updateOperationSearchQuery("");
    clearTextbookListFilters(title);
    window.setTimeout(() => masterSearchRef.current?.select(), 0);
  }

  function showSavedPurchaseFlow(stage: string, title: string, hasCatalogTextbook: boolean) {
    setActiveTab("purchase");
    updateOperationSearchQuery(title);
    setPurchaseBoardScope(getSavedPurchaseBoardScope(stage));
    setPurchaseRequestFilter(getSavedPurchaseRequestFilter(stage, hasCatalogTextbook));
    setPurchaseOrderFilter(getSavedPurchaseOrderFilter(stage, hasCatalogTextbook));
    window.setTimeout(() => operationSearchRef.current?.select(), 0);
  }

  function openInventoryShortageQueue() {
    changeActiveTab("inventory");
    changeInventoryFilter("shortage");
  }

  function openTextbookOpsQueue(key: TextbookOpsQueueKey | "") {
    setMessage("");
    updateOperationSearchQuery("");
    if (!key) {
      setPurchaseRequestFilter("all");
      setPurchaseOrderFilter("all");
      setSalesProcessFilter("all");
      changeInventoryFilter("all");
      setPurchaseBoardScope("active");
      return;
    }
    if (key !== "stockRisk") {
      changeInventoryFilter("all");
    }
    if (key === "unregistered") {
      setActiveTab("purchase");
      setPurchaseRequestFilter("unregistered");
      setPurchaseOrderFilter("all");
      setSalesProcessFilter("all");
      setPurchaseBoardScope("active");
      return;
    }
    if (key === "order") {
      setActiveTab("purchase");
      setPurchaseRequestFilter("all");
      setPurchaseOrderFilter("waiting");
      setSalesProcessFilter("all");
      setPurchaseBoardScope("active");
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
        return current.filter((id) => !visibleTextbookIdSet.has(id));
      }
      return [...new Set([...current, ...visibleTextbookIds])];
    });
  }

  function toggleVisibleTextbookIds(ids: string[], checked: boolean) {
    setSelectedTextbookIds((current) => {
      const idSet = new Set(ids);
      if (!checked) {
        return current.filter((id) => !idSet.has(id));
      }
      return [...new Set([...current, ...idSet])];
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
      const idSet = new Set(ids);
      if (!checked) {
        return current.filter((id) => !idSet.has(id));
      }
      return [...new Set([...current, ...idSet])];
    });
  }

  function toggleSaleLineSelection(id: string, checked: boolean) {
    setSelectedSaleLineIds((current) => {
      if (!id) return current;
      if (checked) {
        return current.includes(id) ? current : [...current, id];
      }
      return current.filter((item) => item !== id);
    });
  }

  function toggleVisibleSaleLineSelection(ids: string[], checked: boolean) {
    setSelectedSaleLineIds((current) => {
      const idSet = new Set(ids);
      if (!checked) {
        return current.filter((id) => !idSet.has(id));
      }
      return [...new Set([...current, ...idSet])];
    });
  }

  function toggleClosingSelection(id: string, checked: boolean) {
    setSelectedClosingIds((current) => {
      if (!id) return current;
      if (checked) {
        return current.includes(id) ? current : [...current, id];
      }
      return current.filter((item) => item !== id);
    });
  }

  function toggleVisibleClosingSelection(ids: string[], checked: boolean) {
    setSelectedClosingIds((current) => {
      const idSet = new Set(ids);
      if (!checked) {
        return current.filter((id) => !idSet.has(id));
      }
      return [...new Set([...current, ...idSet])];
    });
  }

  function openBulkOrderDialog() {
    if (selectedBulkOrderLines.length === 0) {
      return;
    }

    setBulkOrderQuantities(Object.fromEntries(selectedBulkOrderLines.map((line) => {
      const order = getPurchaseLineOrder(line, purchaseOrdersById);
      const draft = buildPurchaseCardDraft(line, order);
      return [getRecordId(line), getPositivePurchaseQuantityText(draft.orderedQuantity) || draft.requestedQuantity || "1"];
    })));
    setBulkOrderDialogOpen(true);
    setMessage("");
  }

  function closeBulkOrderDialog() {
    setBulkOrderDialogOpen(false);
    setBulkOrderQuantities({});
    setMessage("");
    window.setTimeout(() => setBulkOrderDialogOpen(false), 0);
  }

  function setBulkOrderQuantity(lineId: string, value: string) {
    setBulkOrderQuantities((current) => ({ ...current, [lineId]: value }));
  }

  function applyConfiguredPurchasePricingToPayload(payload: Row) {
    const textbook = getTextbookById(data.textbooks, text(payload.textbookId || payload.requestedTextbookTitle));
    const supplierId =
      getConfiguredSupplierIdForTextbook(textbook, data.publisherSupplierLinks, data.publishers) ||
      text(payload.supplierId);

    return {
      ...payload,
      textbookId: getRecordId(textbook || {}) || text(payload.textbookId),
      supplierId,
      unitCost: String(getConfiguredTextbookPurchaseUnitCost(textbook, supplierId, data.suppliers, payload.unitCost, getTextbookCopyScope(payload))),
    };
  }

  function getPurchaseLineTextbookId(line: Row) {
    const draft = buildPurchaseCardDraft(line, getPurchaseLineOrder(line, purchaseOrdersById));
    const textbook = getTextbookById(data.textbooks, text(line.textbook_id || line.textbookId) || draft.requestedTextbookTitle);
    return getRecordId(textbook || {}) || text(line.textbook_id || line.textbookId);
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
          const orderedQuantity = normalizeQuantityInput(bulkOrderQuantities[lineId]) || getPositivePurchaseQuantityText(draft.orderedQuantity) || draft.requestedQuantity || "1";
          return textbookService.updatePurchaseLifecycle({
            ...applyConfiguredPurchasePricingToPayload(buildPurchasePayloadFromDraft(
              line,
              order,
              {
                ...draft,
                orderedQuantity,
              },
              "ordered",
            )),
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

  function receiveSelectedPurchaseLines() {
    if (selectedReceivablePurchaseLines.length === 0) {
      return;
    }

    void runAction(
      "purchase-bulk-receive",
      async () => {
        await Promise.all(selectedReceivablePurchaseLines.map((line) => {
          const order = getPurchaseLineOrder(line, purchaseOrdersById);
          const draft = buildPurchaseCardDraft(line, order);
          const orderedQuantity = draft.orderedQuantity || draft.requestedQuantity || "1";
          return textbookService.updatePurchaseLifecycle({
            ...applyConfiguredPurchasePricingToPayload(buildPurchasePayloadFromDraft(
              line,
              order,
              {
                ...draft,
                orderedQuantity,
                receivedQuantity: orderedQuantity,
                statementNumber: draft.statementNumber || "bulk-receive",
              },
              "received",
            )),
            createdBy: currentUserId,
          });
        }));
        setSelectedPurchaseLineIds([]);
      },
      `${formatQuantity(selectedReceivablePurchaseLines.length)}건을 입고 완료했습니다.`,
    );
  }

  function setBulkTextbookPatchField(name: keyof typeof emptyBulkTextbookPatch, value: string) {
    setBulkTextbookPatch((current) => {
      if (name === "subject") {
        const nextCategory = value === "keep" || getSubSubjectOptionsForSubject(textbookSubSubjectSettings, value).includes(current.category)
          ? current.category
          : "";
        return { ...current, subject: value, category: nextCategory };
      }

      if (name === "schoolLevel") {
        const nextGrade = value === "keep" || value === "none" || getGradeOptionsForSchoolLevel(value).some((option) => option.value === current.gradeLevel)
          ? current.gradeLevel
          : "keep";
        return { ...current, schoolLevel: value, gradeLevel: nextGrade };
      }

      return { ...current, [name]: value };
    });
  }

  function hasBulkTextbookPatchValues() {
    return bulkTextbookPatch.subject !== "keep" ||
      bulkTextbookPatch.schoolLevel !== "keep" ||
      bulkTextbookPatch.gradeLevel !== "keep" ||
      text(bulkTextbookPatch.category) ||
      text(bulkTextbookPatch.publisher) ||
      text(bulkTextbookPatch.price) ||
      bulkTextbookPatch.status !== "keep";
  }

  function getBulkTextbookPatchValues(row: Row) {
    const patch: Row = {};
    if (bulkTextbookPatch.subject !== "keep") patch.subject = bulkTextbookPatch.subject;
    if (text(bulkTextbookPatch.publisher)) patch.publisher = text(bulkTextbookPatch.publisher);
    if (text(bulkTextbookPatch.price)) patch.price = text(bulkTextbookPatch.price);
    if (bulkTextbookPatch.status !== "keep") patch.status = bulkTextbookPatch.status;

    const nextSchoolLevel = bulkTextbookPatch.schoolLevel === "keep"
      ? getTextbookSchoolLevel(row)
      : bulkTextbookPatch.schoolLevel === "none" ? "" : bulkTextbookPatch.schoolLevel;
    const nextGradeLevel = bulkTextbookPatch.gradeLevel === "keep"
      ? getTextbookGradeLevel(row)
      : bulkTextbookPatch.gradeLevel === "none" ? "" : bulkTextbookPatch.gradeLevel;
    const nextSubSubject = text(bulkTextbookPatch.category) || getTextbookSubSubject(row);
    const taxonomyChanged =
      bulkTextbookPatch.schoolLevel !== "keep" ||
      bulkTextbookPatch.gradeLevel !== "keep" ||
      Boolean(text(bulkTextbookPatch.category));

    if (taxonomyChanged) {
      if (bulkTextbookPatch.schoolLevel !== "keep") patch.schoolLevel = nextSchoolLevel;
      if (bulkTextbookPatch.gradeLevel !== "keep") patch.gradeLevel = nextGradeLevel;
      if (text(bulkTextbookPatch.category)) patch.subSubject = nextSubSubject;
      patch.category = buildTextbookCategoryValue({
        schoolLevel: nextSchoolLevel,
        gradeLevel: nextGradeLevel,
        subSubject: nextSubSubject,
      }) || nextSubSubject || text(row.category);
    }

    return patch;
  }

  function applyBulkTextbookEdit() {
    if (selectedTextbookRows.length === 0 || !hasBulkTextbookPatchValues()) {
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
              ...getBulkTextbookPatchValues(row),
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

    setTextbookDeleteDialogOpen(true);
  }

  function confirmDeleteSelectedTextbooks() {
    if (selectedTextbookRows.length === 0) {
      setTextbookDeleteDialogOpen(false);
      return;
    }

    let deleteResult: Awaited<ReturnType<typeof textbookService.deleteTextbookMasters>> | undefined;
    const targetIds = [...selectedTextbookIds];
    const targetCount = selectedTextbookRows.length;
    const shouldClearSearchAfterDelete = Boolean(text(query)) &&
      filteredInventory.length > 0 &&
      filteredInventory.every((row) => targetIds.includes(getRecordId(row)));
    setTextbookDeleteDialogOpen(false);

    void runAction(
      "textbook-bulk-delete",
      async () => {
        deleteResult = await textbookService.deleteTextbookMasters(targetIds);
        if (shouldClearSearchAfterDelete) {
          updateMasterSearchQuery("");
        } else {
          clearMasterSelection();
        }
      },
      () => getTextbookDeleteResultMessage(deleteResult, targetCount),
    );
  }

  function emptyInactiveTextbookTrash() {
    const targetIds = inactiveTextbookRows.map(getRecordId).filter(Boolean);
    if (targetIds.length === 0) {
      setMessage("비울 미사용 교재가 없습니다.");
      return;
    }

    let deleteResult: Awaited<ReturnType<typeof textbookService.purgeInactiveTextbooks>> | undefined;
    requestTextbookConfirmation({
      title: "미사용 보관함 비우기",
      description: `${formatQuantity(targetIds.length)}개 미사용 교재를 영구 삭제합니다. 이 작업은 되돌릴 수 없습니다.`,
      confirmLabel: "영구 삭제",
      items: inactiveTextbookTrashItems,
      onConfirm: () => {
        void runAction(
          "textbook-trash-empty",
          async () => {
            deleteResult = await textbookService.purgeInactiveTextbooks(targetIds);
            clearMasterSelection();
            setBulkTextbookPatch(emptyBulkTextbookPatch);
            setTextbookQualityFilter("all");
          },
          () => `${formatQuantity(deleteResult?.deletedIds.length || targetIds.length)}개 미사용 교재를 영구 삭제했습니다.`,
        );
      },
    });
  }

  function selectPurchaseLine(line: Row, order: Row | undefined, stageOverride?: string) {
    const scopeLines = getPurchaseScopeLines(line);
    const primaryLine = scopeLines.find((scopeLine) => getRecordId(scopeLine) === getRecordId(line)) || scopeLines[0];
    const primaryOrder = order || getPurchaseLineOrder(primaryLine, purchaseOrdersById);
    const studentLine = scopeLines.find((scopeLine) => getTextbookCopyScope(scopeLine) === "student");
    const teacherLine = scopeLines.find((scopeLine) => getTextbookCopyScope(scopeLine) === "teacher");
    const status = text(primaryOrder?.status || primaryLine.status);
    const orderedQuantity = getRowFieldText(primaryLine, "ordered_quantity", "orderedQuantity");
    const requestedQuantity = getRowFieldText(primaryLine, "requested_quantity", "requestedQuantity");
    const primaryRequestedQuantity = requestedQuantity || orderedQuantity || "1";
    const nextStage = stageOverride || purchaseStageFromStatus(status);
    const nextOrderedQuantity = nextStage === "request" ? orderedQuantity : getPositivePurchaseQuantityText(orderedQuantity) || primaryRequestedQuantity;
    const requestedTitle = getRequestedTextbookTitle(primaryLine);
    const textbook = getTextbookById(data.textbooks, text(primaryLine.textbook_id || primaryLine.textbookId) || requestedTitle);
    const copyScope = getTextbookCopyScope(primaryLine);
    const nextReceivedQuantity = nextStage === "receive"
      ? getRowFieldText(primaryLine, "received_quantity", "receivedQuantity") || nextOrderedQuantity || primaryRequestedQuantity
      : getRowFieldText(primaryLine, "received_quantity", "receivedQuantity");
    const studentRequestedQuantity = firstNonBlankText(
      getRowFieldText(studentLine, "requested_quantity", "requestedQuantity"),
      getRowFieldText(studentLine, "ordered_quantity", "orderedQuantity"),
      getRowFieldText(studentLine, "received_quantity", "receivedQuantity"),
    );
    const teacherRequestedQuantity = firstNonBlankText(
      getRowFieldText(teacherLine, "requested_quantity", "requestedQuantity"),
      getRowFieldText(teacherLine, "ordered_quantity", "orderedQuantity"),
      getRowFieldText(teacherLine, "received_quantity", "receivedQuantity"),
    );
    const studentOrderedQuantity = getRowFieldText(studentLine, "ordered_quantity", "orderedQuantity");
    const teacherOrderedQuantity = getRowFieldText(teacherLine, "ordered_quantity", "orderedQuantity");
    const studentBaseQuantity = studentRequestedQuantity || (!teacherLine ? primaryRequestedQuantity : "");
    const teacherBaseQuantity = teacherRequestedQuantity || (!studentLine ? primaryRequestedQuantity : "");
    const nextStudentOrderedQuantity = nextStage === "request" ? studentOrderedQuantity : getPositivePurchaseQuantityText(studentOrderedQuantity) || studentBaseQuantity;
    const nextTeacherOrderedQuantity = nextStage === "request" ? teacherOrderedQuantity : getPositivePurchaseQuantityText(teacherOrderedQuantity) || teacherBaseQuantity;
    const nextStudentReceivedQuantity = nextStage === "receive"
      ? getPositivePurchaseQuantityText(getRowFieldText(studentLine, "received_quantity", "receivedQuantity")) || nextStudentOrderedQuantity || studentBaseQuantity
      : getRowFieldText(studentLine, "received_quantity", "receivedQuantity");
    const nextTeacherReceivedQuantity = nextStage === "receive"
      ? getPositivePurchaseQuantityText(getRowFieldText(teacherLine, "received_quantity", "receivedQuantity")) || nextTeacherOrderedQuantity || teacherBaseQuantity
      : getRowFieldText(teacherLine, "received_quantity", "receivedQuantity");
    setSelectedPurchaseLineId(getRecordId(primaryLine));
    setSelectedPurchaseScopeLineIds({
      student: getRecordId(studentLine || {}),
      teacher: getRecordId(teacherLine || {}),
    });
    setPurchaseRequestInputMode(textbook ? "catalog" : "manual");
    setPurchaseForm({
      requestStage: nextStage,
      copyScope,
      textbookId: getRecordId(textbook || {}) || text(primaryLine.textbook_id || primaryLine.textbookId),
      requestedTextbookTitle: requestedTitle || getTextbookTitle(textbook || {}) || text(primaryLine.textbook_id || primaryLine.textbookId),
      classId: text(primaryLine.class_id || primaryLine.classId),
      supplierId: text(primaryOrder?.supplier_id || primaryOrder?.supplierId),
      locationId: text(primaryLine.location_id || primaryLine.locationId),
      requestBy: text(primaryOrder?.requested_by || primaryOrder?.requestedBy),
      requestedQuantity: primaryRequestedQuantity,
      orderedQuantity: nextOrderedQuantity,
      receivedQuantity: nextReceivedQuantity,
      studentRequestedQuantity: studentBaseQuantity,
      teacherRequestedQuantity: teacherBaseQuantity,
      studentOrderedQuantity: nextStudentOrderedQuantity,
      teacherOrderedQuantity: nextTeacherOrderedQuantity,
      studentReceivedQuantity: nextStudentReceivedQuantity,
      teacherReceivedQuantity: nextTeacherReceivedQuantity,
      unitCost: text(primaryLine.unit_cost || primaryLine.unitCost),
      statementNumber: text(primaryOrder?.statement_number || primaryOrder?.statementNumber),
      memo: text(primaryLine.memo || primaryOrder?.memo),
    });
    setPurchaseDialogOpen(true);
    setMessage("");
  }

  async function runAction(name: string, action: () => Promise<unknown>, success: string | (() => string)) {
    let shouldRefresh = false;
    setSaving(name);
    setMessage("");
    setActionErrorMessage("");
    try {
      await action();
      setMessage(typeof success === "function" ? success() : success);
      shouldRefresh = true;
      return true;
    } catch (actionError) {
      setActionErrorMessage(getTextbookActionErrorMessage(actionError));
      return false;
    } finally {
      setSaving("");
      if (shouldRefresh) {
        void refresh().catch((refreshError) => {
          setActionErrorMessage(getTextbookActionErrorMessage(refreshError));
        });
      }
    }
  }

  function submitMaster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isNewMasterDuplicate) {
      setActionErrorMessage("이미 등록된 교재입니다. 기존 교재를 열어 수정하세요.");
      return;
    }
    const masterPayload = {
      ...masterForm,
      title: normalizeStoredTextInput(masterForm.title),
      publisher: normalizeStoredTextInput(masterForm.publisher),
      isbn13: normalizeBarcodeValue(masterForm.isbn13),
      barcode: normalizeBarcodeValue(masterForm.barcode || masterForm.isbn13),
      category: buildTextbookCategoryValue(masterForm) || masterForm.category,
    };
    const completedMasterTitle = getTextbookTitle(masterPayload);
    void runAction("master", () => textbookService.upsertTextbookMaster(masterPayload), "교재 마스터가 저장되었습니다.").then((ok) => {
      if (ok) {
        if (completedMasterTitle) {
          showSavedMasterTextbook(completedMasterTitle);
        }
        setMasterDialogOpen(false);
        setMasterForm(emptyMasterForm);
      }
    });
  }

  function submitPurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const completedPurchaseStage = purchaseForm.requestStage;
    const completedPurchaseTitle = purchaseRequestTitle;
    const completedPurchaseHasCatalogTextbook = Boolean(selectedPurchaseTextbookId || getRecordId(requestedCatalogTextbook || {}) || purchaseForm.textbookId);
    const purchasePayloads = (["student", "teacher"] as TextbookCopyScope[]).flatMap((scope) => {
      const scopeLineId = selectedPurchaseScopeLineIds[scope] || "";
      const scopeLine = scopeLineId ? purchaseLinesById.get(scopeLineId) : undefined;
      const scopeOrder = scopeLine ? getPurchaseLineOrder(scopeLine, purchaseOrdersById) : undefined;
      const requestedQuantity = normalizePurchaseQuantityField(`${scope}RequestedQuantity`, getPurchaseScopeQuantity(purchaseForm, scope, "requested"));
      const orderedQuantity = purchaseForm.requestStage === "request"
        ? ""
        : normalizePurchaseQuantityField(`${scope}OrderedQuantity`, getPurchaseScopeQuantity(purchaseForm, scope, "ordered")) || requestedQuantity;
      const receivedQuantity = purchaseForm.requestStage === "receive"
        ? normalizePurchaseQuantityField(`${scope}ReceivedQuantity`, getPurchaseScopeQuantity(purchaseForm, scope, "received")) || orderedQuantity
        : "";
      const stageQuantity = purchaseForm.requestStage === "receive"
        ? numberValue(receivedQuantity)
        : purchaseForm.requestStage === "order"
          ? numberValue(orderedQuantity)
          : numberValue(requestedQuantity);
      const canKeepZeroQuantityRequestLine = purchaseForm.requestStage === "request" && Boolean(scopeLineId);

      if (stageQuantity <= 0 && !canKeepZeroQuantityRequestLine) {
        return [];
      }

      return [{
        ...purchaseForm,
        textbookId: selectedPurchaseTextbookId || getRecordId(requestedCatalogTextbook || {}) || purchaseForm.textbookId,
        requestedTextbookTitle: normalizeStoredTextInput(purchaseRequestTitle),
        requestedQuantity: requestedQuantity || (purchaseForm.requestStage === "request" ? orderedQuantity || receivedQuantity || "1" : "0"),
        orderedQuantity,
        receivedQuantity,
        copyScope: scope,
        copy_scope: scope,
        supplierId: configuredPurchaseSupplierId,
        unitCost: String(getConfiguredTextbookPurchaseUnitCost(
          selectedPurchaseTextbook,
          configuredPurchaseSupplierId,
          data.suppliers,
          purchaseForm.unitCost,
          scope,
        )),
        locationId: selectedLocationId,
        purchaseOrderId: getRecordId(scopeOrder || {}),
        purchaseOrderLineId: scopeLineId,
        statementNumber: normalizeStoredTextInput(purchaseForm.statementNumber),
        createdBy: currentUserId,
      }];
    });
    void runAction(
      "purchase",
      async () => {
        for (const purchasePayload of purchasePayloads) {
          if (purchasePayload.purchaseOrderLineId) {
            await textbookService.updatePurchaseLifecycle(purchasePayload);
          } else {
            await textbookService.createPurchaseReceipt(purchasePayload);
          }
        }
      },
      purchaseSuccessMessage(purchaseForm.requestStage, Boolean(selectedPurchaseLineId)),
    ).then((ok) => {
      if (ok) {
        showSavedPurchaseFlow(completedPurchaseStage, completedPurchaseTitle, completedPurchaseHasCatalogTextbook);
        setPurchaseDialogOpen(false);
        setSelectedPurchaseLineId("");
        setSelectedPurchaseScopeLineIds({ student: "", teacher: "" });
        setPurchaseForm(emptyPurchaseForm);
      }
    });
  }

  function submitSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isTeacherSale && saleDuplicateLines.length > 0) {
      setActionErrorMessage("이미 같은 월에 같은 수업·교재 출고가 있습니다. 기존 출고 내역을 먼저 확인하세요.");
      return;
    }
    const completedSaleTitle = getTextbookTitle(selectedSaleTextbook || {});
    const salePayload = {
      ...saleForm,
      chargeMonth: normalizedSaleChargeMonth,
      locationId: saleLocationId,
      copy_scope: saleCopyScope,
      memo: normalizeStoredTextInput(saleForm.memo),
      excludedStudentIds,
      createdBy: currentUserId,
    };
    void runAction(
      "sale",
      () => isTeacherSale
        ? textbookService.createTeacherTextbookIssue(
            {
              ...salePayload,
              copyScope: "teacher",
              copy_scope: "teacher",
              teacherName: saleTeacherName,
              quantity: saleTeacherQuantity,
            },
            data as unknown as Row,
          )
        : textbookService.createClassTextbookSale(
            {
              ...salePayload,
              copyScope: "student",
              copy_scope: "student",
            },
            data as unknown as Row,
          ),
      isTeacherSale ? "교사용 출고 대기 목록에 추가했습니다." : "출고 대기 목록에 추가했습니다.",
    ).then((ok) => {
      if (ok) {
        setActiveTab("sales");
        setSalesProcessFilter("waiting");
        updateOperationSearchQuery(completedSaleTitle);
        setSaleDialogOpen(false);
        resetSaleForm();
      }
    });
  }

  function getSaleLineTextbookTitle(line: Row) {
    const textbook = getTextbookById(data.textbooks, text(line.textbook_id || line.textbookId));
    return getTextbookTitle(textbook || {}) || text(line.textbook_title || line.textbookTitle || line.textbook_id || line.textbookId);
  }

  function getSaleStatusFilterAfterAction(status: "issued" | "returned"): SalesProcessFilter {
    return status === "returned" ? "returned" : "issued";
  }

  function showUpdatedSaleLine(line: Row, status: "issued" | "returned") {
    const title = getSaleLineTextbookTitle(line);
    setSalesProcessFilter(getSaleStatusFilterAfterAction(status));
    if (title) {
      updateOperationSearchQuery(title);
    }
  }

  function updateSaleLineStatus(line: Row, status: "issued" | "returned") {
    void runAction(
      `sale-line-${getRecordId(line)}`,
      () => textbookService.updateSaleLineStatus({ saleLineId: getRecordId(line), status, createdBy: currentUserId }, data as unknown as Row),
      status === "returned" ? "고객 반품으로 처리했습니다." : "출고가 반영되었습니다.",
    ).then((ok) => {
      if (ok) {
        showUpdatedSaleLine(line, status);
      }
    });
  }

  function getPurchaseConfirmationItems(line: Row, order: Row | undefined): TextbookConfirmationPreviewItem[] {
    const draft = buildPurchaseCardDraft(line, order);
    const textbook = getTextbookById(data.textbooks, draft.textbookId || draft.requestedTextbookTitle);
    const classRecord = getClassById(data.classes, draft.classId);
    const quantity = numberValue(draft.receivedQuantity || draft.orderedQuantity || draft.requestedQuantity) || 1;
    const locationLabel = getLocationName(locations, draft.locationId) || "위치 미지정";
    const classLabel = classRecord ? getClassName(classRecord) : "수업 미지정";
    const statusLabel = purchaseStatusLabel(line.status || order?.status, draft.orderedQuantity, draft.receivedQuantity);
    return [{
      id: getRecordId(line) || text(line.purchase_order_line_id || line.purchaseOrderLineId) || getPurchaseTextbookTitle(line, textbook),
      title: getPurchaseTextbookTitle(line, textbook),
      detail: [
        getTextbookCopyScopeLabel(draft.copyScope),
        statusLabel,
        `${formatQuantity(quantity)}권`,
        locationLabel,
        classLabel,
        draft.requestBy ? `요청 ${draft.requestBy}` : "",
      ].filter(Boolean).join(" · "),
    }];
  }

  function getSelectedPurchaseConfirmationItems(lines: Row[]) {
    return lines.flatMap((line) => {
      const order = getPurchaseLineOrder(line, purchaseOrdersById);
      return getPurchaseConfirmationItems(line, order);
    });
  }

  function getSaleConfirmationItems(lines: Row[]): TextbookConfirmationPreviewItem[] {
    const salesById = new Map(data.sales.map((sale) => [getRecordId(sale), sale]));
    const studentsById = new Map(data.students.map((student) => [getRecordId(student), student]));
    return lines.map((line, index) => {
      const sale = salesById.get(text(line.sale_id || line.saleId));
      const textbook = getTextbookById(data.textbooks, text(line.textbook_id || line.textbookId));
      const studentId = text(line.student_id || line.studentId);
      const studentName = text(line.student_name || getStudentNameById(studentsById, studentId)) || "학생 미지정";
      const classRecord = getClassById(data.classes, text(line.class_id || line.classId || sale?.class_id || sale?.classId));
      const status = getSaleLineStatus(line, sale);
      const textbookTitle = textbook ? getTextbookTitle(textbook) : text(line.textbook_id || line.textbookId) || "교재 미지정";
      return {
        id: getRecordId(line) || `${studentId || textbookTitle}-confirmation-${index}`,
        title: textbookTitle,
        detail: [
          studentName,
          classRecord ? getClassName(classRecord) : "수업 미지정",
          `${formatQuantity(getSaleLineQuantity(line))}권`,
          saleStatusLabels[status] || status,
          getSaleLineMonth(line, sale),
        ].filter(Boolean).join(" · "),
      };
    });
  }

  function deleteSaleLine(line: Row) {
    const rawStatus = text(line.status);
    const isHistory = rawStatus === "issued" || rawStatus === "returned" || rawStatus === "cancelled";
    if (isHistory && !canDeleteTextbookHistory) {
      return;
    }

    requestTextbookConfirmation({
      title: isHistory ? "출고 이력 삭제" : "출고 대기 취소",
      description: isHistory
        ? "선택한 출고 이력과 연결된 재고 이동 기록을 삭제합니다."
        : "출고 대기 건을 취소하고 삭제합니다.",
      confirmLabel: isHistory ? "이력 삭제" : "취소 삭제",
      items: getSaleConfirmationItems([line]),
      onConfirm: () => {
        void runAction(
          `sale-delete-${getRecordId(line)}`,
          () => textbookService.deleteSaleLineLifecycle({
            saleLineId: getRecordId(line),
            saleId: text(line.sale_id || line.saleId),
          }),
          isHistory ? "출고 이력을 삭제했습니다." : "출고 대기 건을 삭제했습니다.",
        );
      },
    });
  }

  function returnSaleLine(line: Row) {
    requestTextbookConfirmation({
      title: "고객 반품 처리",
      description: "출고 완료 건을 고객 반품으로 처리합니다.",
      confirmLabel: "반품 처리",
      items: getSaleConfirmationItems([line]),
      onConfirm: () => updateSaleLineStatus(line, "returned"),
    });
  }

  function issueSelectedSaleLines() {
    if (selectedIssuableSaleLines.length === 0) {
      return;
    }
    const issuedTextbookTitles = [...new Set(selectedIssuableSaleLines
      .map((line) => {
        const textbook = getTextbookById(data.textbooks, text(line.textbook_id || line.textbookId));
        return getTextbookTitle(textbook || {});
      })
      .filter(Boolean))];

    void runAction(
      "sale-bulk-issue",
      async () => {
        await Promise.all(selectedIssuableSaleLines.map((line) =>
          textbookService.updateSaleLineStatus({ saleLineId: getRecordId(line), status: "issued", createdBy: currentUserId }, data as unknown as Row),
        ));
        setSelectedSaleLineIds([]);
        setSalesProcessFilter("issued");
        if (issuedTextbookTitles.length === 1) {
          updateOperationSearchQuery(issuedTextbookTitles[0]);
        }
      },
      `${formatQuantity(selectedIssuableSaleLines.length)}건을 출고 완료했습니다.`,
    );
  }

  function cancelSelectedSaleLines() {
    if (selectedCancelableSaleLines.length === 0) {
      return;
    }
    requestTextbookConfirmation({
      title: "출고 전 취소",
      description: `${formatQuantity(selectedCancelableSaleLines.length)}건을 출고 전 취소로 삭제합니다.`,
      confirmLabel: "취소 삭제",
      items: getSaleConfirmationItems(selectedCancelableSaleLines),
      onConfirm: () => {
        void runAction(
          "sale-bulk-cancel",
          async () => {
            await Promise.all(selectedCancelableSaleLines.map((line) =>
              textbookService.deleteSaleLineLifecycle({
                saleLineId: getRecordId(line),
                saleId: text(line.sale_id || line.saleId),
              }),
            ));
            setSelectedSaleLineIds([]);
          },
          `${formatQuantity(selectedCancelableSaleLines.length)}건을 출고 전 취소했습니다.`,
        );
      },
    });
  }

  function returnSelectedSaleLines() {
    if (selectedReturnableSaleLines.length === 0) {
      return;
    }
    const returnedTextbookTitles = [...new Set(selectedReturnableSaleLines
      .map((line) => getSaleLineTextbookTitle(line))
      .filter(Boolean))];
    requestTextbookConfirmation({
      title: "고객 반품 처리",
      description: `${formatQuantity(selectedReturnableSaleLines.length)}건을 고객 반품으로 처리합니다.`,
      confirmLabel: "반품 처리",
      items: getSaleConfirmationItems(selectedReturnableSaleLines),
      onConfirm: () => {
        void runAction(
          "sale-bulk-return",
          async () => {
            await Promise.all(selectedReturnableSaleLines.map((line) =>
              textbookService.updateSaleLineStatus({ saleLineId: getRecordId(line), status: "returned", createdBy: currentUserId }, data as unknown as Row),
            ));
            setSelectedSaleLineIds([]);
            setSalesProcessFilter("returned");
            if (returnedTextbookTitles.length === 1) {
              updateOperationSearchQuery(returnedTextbookTitles[0]);
            }
          },
          `${formatQuantity(selectedReturnableSaleLines.length)}건을 고객 반품으로 처리했습니다.`,
        );
      },
    });
  }

  function deleteSelectedSaleHistoryLines() {
    if (!canDeleteTextbookHistory || selectedDeletableSaleLines.length === 0) {
      return;
    }
    requestTextbookConfirmation({
      title: "출고 이력 삭제",
      description: `${formatQuantity(selectedDeletableSaleLines.length)}건의 출고/반품 이력과 연결된 재고 이동 기록을 삭제합니다.`,
      confirmLabel: "이력 삭제",
      items: getSaleConfirmationItems(selectedDeletableSaleLines),
      onConfirm: () => {
        void runAction(
          "sale-bulk-delete-history",
          async () => {
            await Promise.all(selectedDeletableSaleLines.map((line) =>
              textbookService.deleteSaleLineLifecycle({
                saleLineId: getRecordId(line),
                saleId: text(line.sale_id || line.saleId),
              }),
            ));
            setSelectedSaleLineIds([]);
          },
          `${formatQuantity(selectedDeletableSaleLines.length)}건의 출고/반품 이력을 삭제했습니다.`,
        );
      },
    });
  }

  function movePurchaseLine(line: Row, order: Row | undefined, status: PurchaseKanbanStatus, draft?: PurchaseKanbanDraft) {
    if (text(line.status) === status || text(order?.status) === status) {
      return;
    }

    const scopeLines = getPurchaseScopeLines(line);
    void runAction(
      `purchase-move-${getRecordId(line)}`,
      async () => {
        await Promise.all(scopeLines.map((scopeLine) => {
          const scopeOrder = getPurchaseLineOrder(scopeLine, purchaseOrdersById) || order;
          const movePayload = draft && scopeLines.length === 1
            ? buildPurchasePayloadFromDraft(scopeLine, scopeOrder, draft, status)
            : buildPurchaseStatusPayload(scopeLine, scopeOrder, status);
          return textbookService.updatePurchaseLifecycle(
            applyConfiguredPurchasePricingToPayload(
              {
                ...movePayload,
                textbookId: getPurchaseLineTextbookId(scopeLine) || text(movePayload.textbookId),
                requestedTextbookTitle: normalizeStoredTextInput(text(movePayload.requestedTextbookTitle || getRequestedTextbookTitle(scopeLine))),
              },
            ),
          );
        }));
      },
      "상태가 변경되었습니다.",
    );
  }

  function deletePurchaseLine(line: Row, order: Row | undefined) {
    const scopeLines = getPurchaseScopeLines(line);
    requestTextbookConfirmation({
      title: scopeLines.length > 1 ? "요청 묶음 삭제" : "요청 삭제",
      description: scopeLines.length > 1
        ? "학생용과 교사용 요청을 함께 삭제합니다."
        : "이 요청 건을 삭제합니다.",
      confirmLabel: "삭제",
      items: scopeLines.flatMap((scopeLine) =>
        getPurchaseConfirmationItems(scopeLine, getPurchaseLineOrder(scopeLine, purchaseOrdersById) || order)),
      onConfirm: () => {
        void runAction(
          `purchase-delete-${getRecordId(line)}`,
          async () => {
            await Promise.all(scopeLines.map((scopeLine) => {
              const scopeOrder = getPurchaseLineOrder(scopeLine, purchaseOrdersById) || order;
              return textbookService.deletePurchaseLifecycle({
                purchaseOrderId: getRecordId(scopeOrder || {}) || text(scopeLine.purchase_order_id || scopeLine.purchaseOrderId),
                purchaseOrderLineId: getRecordId(scopeLine),
              });
            }));
          },
          scopeLines.length > 1 ? "요청 묶음을 삭제했습니다." : "요청 건을 삭제했습니다.",
        );
      },
    });
  }

  function returnPurchaseLine(line: Row, order: Row | undefined) {
    requestTextbookConfirmation({
      title: "공급처 반품",
      description: "입고 완료 건을 공급처 반품으로 처리합니다.",
      confirmLabel: "반품 처리",
      items: getPurchaseConfirmationItems(line, order),
      onConfirm: () => {
        void runAction(
          `purchase-return-${getRecordId(line)}`,
          () => textbookService.returnPurchaseLifecycle({
            purchaseOrderId: getRecordId(order || {}) || text(line.purchase_order_id || line.purchaseOrderId),
            purchaseOrderLineId: getRecordId(line),
            createdBy: currentUserId,
            memo: "공급처 반품",
          }),
          "공급처 반품으로 처리했습니다.",
        );
      },
    });
  }

  function returnSelectedPurchaseLines() {
    if (selectedReturnablePurchaseLines.length === 0) {
      return;
    }
    requestTextbookConfirmation({
      title: "공급처 반품",
      description: `${formatQuantity(selectedReturnablePurchaseLines.length)}건을 공급처 반품으로 처리합니다.`,
      confirmLabel: "반품 처리",
      items: getSelectedPurchaseConfirmationItems(selectedReturnablePurchaseLines),
      onConfirm: () => {
        void runAction(
          "purchase-bulk-return",
          async () => {
            await Promise.all(selectedReturnablePurchaseLines.map((line) => {
              const order = getPurchaseLineOrder(line, purchaseOrdersById);
              return textbookService.returnPurchaseLifecycle({
                purchaseOrderId: getRecordId(order || {}) || text(line.purchase_order_id || line.purchaseOrderId),
                purchaseOrderLineId: getRecordId(line),
                createdBy: currentUserId,
                memo: "공급처 반품",
              });
            }));
            setSelectedPurchaseLineIds([]);
          },
          `${formatQuantity(selectedReturnablePurchaseLines.length)}건을 공급처 반품으로 처리했습니다.`,
        );
      },
    });
  }

  function setInventoryCountDraft(row: InventoryCountRow, value: string) {
    setInventoryCountDrafts((current) => ({
      ...current,
      [getInventoryCountDraftKey(row.id, row.locationId)]: normalizeQuantityInput(value, { allowZero: true }),
    }));
  }

  function setInventoryCountMemoDraft(row: InventoryCountRow, value: string) {
    setInventoryCountMemoDrafts((current) => ({
      ...current,
      [getInventoryCountDraftKey(row.id, row.locationId)]: normalizeInlineTextInput(value),
    }));
  }

  function clearInventoryCountDraft(row: InventoryCountRow) {
    const draftKey = getInventoryCountDraftKey(row.id, row.locationId);
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

  function submitInlineStockCount(row: InventoryCountRow, countedQuantity: string, memo = "") {
    const normalizedQuantity = normalizeQuantityInput(countedQuantity, { allowZero: true });
    const normalizedMemo = normalizeStoredTextInput(memo);
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
        memo: normalizedMemo,
        createdBy: currentUserId,
      }),
      "실사 수량이 반영되었습니다.",
    ).then((ok) => {
      if (ok) {
        setInventoryAuditFilter("done");
        updateMasterSearchQuery(row.title);
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

  function submitBulkInlineStockCounts(rows: InventoryCountRow[]) {
    const readyRows = rows.filter((row) => (
      normalizeQuantityInput(inventoryCountDrafts[getInventoryCountDraftKey(row.id, row.locationId)], { allowZero: true })
    ));
    if (readyRows.length === 0) {
      setMessage("선택한 교재의 실사 수량을 먼저 입력하세요.");
      return;
    }

    void runAction(
      "count-inline-bulk",
      async () => {
        await Promise.all(readyRows.map((row) => {
          const draftKey = getInventoryCountDraftKey(row.id, row.locationId);
          return textbookService.createStockCountAdjustment({
            textbookId: row.id,
            locationId: row.locationId,
            countedQuantity: normalizeQuantityInput(inventoryCountDrafts[draftKey], { allowZero: true }),
            expectedQuantity: row.currentQuantity,
            sale_price: getTextbookSalePrice(row.source),
            memo: normalizeStoredTextInput(inventoryCountMemoDrafts[draftKey]),
            createdBy: currentUserId,
          });
        }));
        setInventoryCountDrafts((current) => {
          const next = { ...current };
          readyRows.forEach((row) => delete next[getInventoryCountDraftKey(row.id, row.locationId)]);
          return next;
        });
        setInventoryCountMemoDrafts((current) => {
          const next = { ...current };
          readyRows.forEach((row) => delete next[getInventoryCountDraftKey(row.id, row.locationId)]);
          return next;
        });
        const readyRowIds = new Set(readyRows.map((row) => row.id));
        setSelectedTextbookIds((current) => current.filter((id) => !readyRowIds.has(id)));
        setInventoryAuditFilter("done");
        if (readyRows.length === 1) {
          updateMasterSearchQuery(readyRows[0].title);
        }
      },
      `${formatQuantity(readyRows.length)}건의 실사 수량을 반영했습니다.`,
    );
  }

  function deleteInventoryHistory(row: InventoryHistoryRow) {
    if (!canDeleteTextbookHistory) {
      return;
    }

    requestTextbookConfirmation({
      title: "재고 이력 삭제",
      description: "선택한 재고 이력을 삭제합니다. 재고 수량도 즉시 다시 계산됩니다.",
      confirmLabel: "이력 삭제",
      onConfirm: () => {
        void runAction(
          `inventory-history-delete-${row.id}`,
          () => textbookService.deleteInventoryHistory({
            kind: row.kind,
            id: row.sourceId,
            linkedMoveId: row.linkedMoveId,
          }),
          "재고 이력을 삭제했습니다.",
        );
      },
    });
  }

  function lockSelectedClosings() {
    if (selectedClosingIds.length === 0) {
      return;
    }

    void runAction(
      "closing-bulk-lock",
      async () => textbookService.updateMonthlyClosingStatus({ ids: selectedClosingIds, status: "locked" }),
      `${formatQuantity(selectedClosingIds.length)}건을 확정했습니다.`,
    ).then((ok) => {
      if (ok) {
        setSelectedClosingIds([]);
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
      async () => {
        await Promise.all(closingTargetSubjects.map((subject) =>
          textbookService.upsertMonthlyClosing({ ...closingForm, subject }, data as unknown as Row),
        ));
      },
      "월마감 초안이 저장되었습니다.",
    ).then((ok) => {
      if (ok) {
        setClosingDialogOpen(false);
      }
    });
  }

  return (
    <div className="flex min-h-[calc(100dvh-5rem)] flex-col gap-4 px-4 py-4 lg:px-6">
      {error || actionErrorMessage || message ? (
        <Alert variant={error || actionErrorMessage ? "destructive" : "default"}>
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>{error || actionErrorMessage || message}</span>
            {error ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 self-start sm:self-auto"
                onClick={() => void refresh()}
                aria-label={lastLoadedAt ? `다시 불러오기 · ${formatLoadedAt(lastLoadedAt)} · ${loadDurationMs}ms` : "다시 불러오기"}
              >
                다시 불러오기
              </Button>
            ) : null}
          </AlertDescription>
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

      <Dialog open={textbookDeleteDialogOpen} onOpenChange={setTextbookDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>선택 교재 정리</DialogTitle>
            <DialogDescription>
              {formatQuantity(selectedTextbookRows.length)}개 교재를 삭제하거나 미사용으로 전환합니다. 재고·주문·출고 이력이 있으면 기록 보존을 위해 미사용으로 전환됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2" aria-label="정리 대상 교재">
            {selectedTextbookCleanupPreviewRows.map((item) => (
              <div key={item.id} className="flex min-w-0 items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm">
                <span className="min-w-0 truncate font-medium">{item.title}</span>
                <span className="shrink-0 truncate text-xs text-muted-foreground">{item.detail || "상세 없음"}</span>
              </div>
            ))}
            {selectedTextbookCleanupMoreCount > 0 ? (
              <div className="rounded-md border border-dashed px-3 py-2 text-center text-xs text-muted-foreground">
                외 {formatQuantity(selectedTextbookCleanupMoreCount)}개
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTextbookDeleteDialogOpen(false)} disabled={saving === "textbook-bulk-delete"}>
              취소
            </Button>
            <Button type="button" variant="destructive" onClick={confirmDeleteSelectedTextbooks} disabled={saving === "textbook-bulk-delete"}>
              {saving === "textbook-bulk-delete" ? "정리 중" : "정리 실행"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmationRequest)} onOpenChange={(open) => !open && setConfirmationRequest(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmationRequest?.title || "확인"}</DialogTitle>
            <DialogDescription>{confirmationRequest?.description}</DialogDescription>
          </DialogHeader>
          {confirmationRequest?.items?.length ? (
            <div className="grid gap-2" aria-label="확인 대상">
              {confirmationRequest.items.slice(0, 5).map((item) => (
                <div key={item.id} className="min-w-0 rounded-md border bg-muted/30 px-3 py-2">
                  <p className="truncate font-medium text-foreground">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.detail || "상세 없음"}</p>
                </div>
              ))}
              {confirmationRequest.items.length > 5 ? (
                <div className="text-xs text-muted-foreground">
                  외 {formatQuantity(confirmationRequest.items.length - 5)}건 더
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmationRequest(null)}>
              취소
            </Button>
            <Button type="button" variant="destructive" onClick={confirmTextbookAction}>
              {confirmationRequest?.confirmLabel || "확인"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {masterDialogOpen ? (
      <Dialog open={masterDialogOpen} onOpenChange={(open) => (open ? setMasterDialogOpen(true) : closeMasterDialog())}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] overflow-x-hidden overflow-y-auto p-4 sm:max-w-3xl sm:p-6">
          <DialogHeader>
            <DialogTitle>{masterForm.id ? "교재 수정" : "교재 신규 등록"}</DialogTitle>
            <DialogDescription className="sr-only">교재명, 학년, 세부과목, 출판사, 판매가, ISBN, 바코드를 등록하거나 수정합니다.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitMaster} className="grid min-w-0 gap-3" aria-busy={saving === "master"}>
            <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_140px_140px]">
              <Field label="교재명" required>
                <Input
                  name="title"
                  value={masterForm.title}
                  onChange={(event) => setMasterTextField("title", event.target.value)}
                  onBlur={() => settleMasterTextField("title")}
                  placeholder="예: 쎈 고등 수학 2"
                  aria-label="교재명"
                  autoComplete="off"
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
              <div className="grid gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900" role="alert">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="font-medium">이미 등록된 교재 {formatQuantity(masterDuplicateRows.length)}건</span>
                  <Badge variant="outline" className="rounded-md border-amber-300 bg-white text-amber-700">저장 잠김</Badge>
                </div>
                <div className="grid gap-1">
                  {masterDuplicatePreviewRows.map((row) => {
                    const rowId = getRecordId(row);
                    const duplicateLabel = [getPublisherLabel(row), getCategoryLabel(row)].filter(Boolean).join(" · ");
                    return (
                      <button
                        key={rowId}
                        type="button"
                        className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5 text-left text-amber-950 shadow-sm transition hover:bg-amber-100"
                        onClick={() => openDuplicateMaster(row)}
                        aria-label={`${getTextbookTitle(row)} 기존 교재 열기`}
                      >
                        <span className="min-w-0 truncate">{getTextbookTitle(row)}</span>
                        <span className="shrink-0 text-xs text-amber-700">{duplicateLabel || "기존 교재"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
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
                <SearchCombobox
                  options={masterPublisherOptions}
                  value={masterForm.publisher || "none"}
                  onValueChange={(value) => {
                    setMasterForm((current) => ({
                      ...current,
                      publisher: normalizeStoredTextInput(value === "none" ? "" : value),
                    }));
                  }}
                  placeholder="출판사 선택"
                  searchPlaceholder="출판사 검색"
                  emptyLabel="설정된 출판사가 없습니다"
                  ariaLabel="출판사 선택"
                />
              </Field>
              <Field label="판매가">
                <Input
                  name="price"
                  value={masterForm.price}
                  onChange={(event) => setMasterForm((current) => ({ ...current, price: normalizeMoneyInput(event.target.value) }))}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="예: 12000"
                  aria-label="판매가"
                  autoComplete="off"
                />
              </Field>
            </div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <Field label="ISBN">
                <Input
                  name="isbn13"
                  value={masterForm.isbn13}
                  onChange={(event) => setMasterIsbn13(event.target.value)}
                  inputMode="numeric"
                  placeholder="13자리 ISBN"
                  aria-label="ISBN"
                  autoComplete="off"
                />
              </Field>
              <Field label="바코드">
                <div className="relative">
                  <Barcode className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    name="barcode"
                    value={masterForm.barcode}
                    onChange={(event) => setMasterForm((current) => ({ ...current, barcode: normalizeBarcodeValue(event.target.value) }))}
                    className="pl-9"
                    inputMode="numeric"
                    placeholder="스캔 또는 입력"
                    aria-label="바코드"
                    autoComplete="off"
                  />
                </div>
              </Field>
            </div>
            <div className={dialogFooterClassName}>
              <Button type="button" variant="outline" onClick={closeMasterDialog} aria-label="교재 등록 취소" title="취소">
                취소
              </Button>
              <Button
                type="submit"
                disabled={masterSubmitDisabled}
                aria-label={saving === "master" ? "교재 저장 중" : "교재 저장"}
                title={!masterTitleValue ? "교재명을 입력하세요" : isNewMasterDuplicate ? "이미 등록된 교재입니다" : "교재 저장"}
              >
                <Save className="mr-2 size-4" />
                {saving === "master" ? "저장 중" : masterForm.id ? "수정 저장" : "저장"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      ) : null}

      {purchaseDialogOpen ? (
      <Dialog open={purchaseDialogOpen} onOpenChange={(open) => (open ? setPurchaseDialogOpen(true) : closePurchaseDialog())}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] overflow-x-hidden overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{getPurchaseDialogTitle(purchaseForm.requestStage, Boolean(selectedPurchaseLineId))}</DialogTitle>
            <DialogDescription className="sr-only">교재 요청, 주문, 입고 단계에 필요한 수량과 연결 정보를 저장합니다.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitPurchase} className="grid min-w-0 max-w-full gap-3 [&>*]:min-w-0 [&>*]:max-w-full" aria-busy={saving === "purchase"}>
            {purchaseForm.requestStage === "request" ? (
              <div className="grid gap-3">
                <section className="grid gap-2 rounded-lg border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium text-foreground">교재명</div>
                    <div className="grid grid-cols-2 rounded-md border bg-background p-0.5" role="group" aria-label="요청 교재 입력 방식">
                      <Button
                        type="button"
                        variant={purchaseRequestUsesCatalog ? "default" : "ghost"}
                        size="sm"
                        className="h-7 rounded"
                        aria-pressed={purchaseRequestUsesCatalog}
                        onClick={() => {
                          setPurchaseRequestInputMode("catalog");
                          setPurchaseField("requestedTextbookTitle", "");
                        }}
                      >
                        등록 교재
                      </Button>
                      <Button
                        type="button"
                        variant={!purchaseRequestUsesCatalog ? "default" : "ghost"}
                        size="sm"
                        className="h-7 rounded"
                        aria-pressed={!purchaseRequestUsesCatalog}
                        onClick={() => {
                          setPurchaseRequestInputMode("manual");
                          setPurchaseField("textbookId", "");
                        }}
                      >
                        직접 입력
                      </Button>
                    </div>
                  </div>
                  {purchaseRequestUsesCatalog ? (
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_2.5rem]">
                      <TextbookSelect
                        textbooks={activeTextbooks}
                        value={explicitPurchaseTextbookId}
                        onValueChange={(value) => {
                          setPurchaseRequestInputMode("catalog");
                          setPurchaseField("textbookId", value);
                        }}
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
                  ) : (
                    <Input
                      value={purchaseForm.requestedTextbookTitle}
                      onChange={(event) => setPurchaseField("requestedTextbookTitle", event.target.value)}
                      onBlur={() => settlePurchaseTextField("requestedTextbookTitle")}
                      aria-label="요청 교재명"
                      placeholder="교재명을 그대로 입력"
                      required
                    />
                  )}
                  {hasManualPurchaseCatalogMatch ? (
                    <div className="grid gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900" role="alert">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="font-medium">등록 교재가 있습니다</span>
                        <Badge variant="outline" className="rounded-md border-amber-300 bg-white text-amber-700">등록 교재 연결</Badge>
                      </div>
                      <div className="grid gap-1">
                        {manualPurchaseCatalogMatches.map((row) => {
                          const rowId = getRecordId(row);
                          const matchLabel = [getPublisherLabel(row), getCategoryLabel(row)].filter(Boolean).join(" · ");
                          return (
                            <button
                              key={rowId}
                              type="button"
                              className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5 text-left text-amber-950 shadow-sm transition hover:bg-amber-100"
                              onClick={() => selectCatalogTextbookForPurchaseRequest(row)}
                              aria-label={`${getTextbookTitle(row)} 등록 교재로 선택`}
                            >
                              <span className="min-w-0 truncate">{getTextbookTitle(row)}</span>
                              <span className="shrink-0 text-xs text-amber-700">{matchLabel || "등록 교재"}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </section>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="수업">
                    <ClassSelect classes={data.classes} value={purchaseForm.classId} onValueChange={(value) => setPurchaseField("classId", value)} />
                  </Field>
                  <Field label="학생용 요청">
                    <Input value={purchaseForm.studentRequestedQuantity} onChange={(event) => setPurchaseField("studentRequestedQuantity", event.target.value)} inputMode="numeric" min="0" aria-label="학생용 요청 수량" />
                  </Field>
                  <Field label="교사용 요청">
                    <Input value={purchaseForm.teacherRequestedQuantity} onChange={(event) => setPurchaseField("teacherRequestedQuantity", event.target.value)} inputMode="numeric" min="0" aria-label="교사용 요청 수량" />
                  </Field>
                  <Field label="선생님">
                    <TeacherSelect
                      teachers={data.teacherCatalogs}
                      value={purchaseForm.requestBy}
                      onValueChange={(value) => setPurchaseField("requestBy", value)}
                      ariaLabel="선생님 선택"
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="위치">
                      <LocationSelect
                        locations={locations}
                        value={selectedLocationId}
                        onValueChange={(value) => setPurchaseField("locationId", value)}
                        ariaLabel="요청 위치 선택"
                      />
                    </Field>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-[150px_minmax(220px,1fr)_minmax(180px,0.8fr)]">
                <Field label="단계">
                  <Select value={purchaseForm.requestStage} onValueChange={(value) => setPurchaseField("requestStage", value)}>
                    <SelectTrigger className="w-full" aria-label="처리 단계 선택"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="request">요청 접수</SelectItem>
                      <SelectItem value="order">공급처 주문</SelectItem>
                      <SelectItem value="receive">입고 처리</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="등록 교재" required>
                  <TextbookSelect
                    textbooks={activeTextbooks}
                    value={selectedPurchaseTextbookId || purchaseForm.textbookId}
                    onValueChange={(value) => setPurchaseField("textbookId", value)}
                  />
                </Field>
                <Field label="수업">
                  <ClassSelect classes={data.classes} value={purchaseForm.classId} onValueChange={(value) => setPurchaseField("classId", value)} />
                </Field>
              </div>
            )}
            {purchaseForm.requestStage !== "request" && purchaseForm.requestedTextbookTitle ? (
              <Badge variant="outline" className="w-fit rounded-md">
                요청 교재명 {purchaseForm.requestedTextbookTitle}
              </Badge>
            ) : null}
            {purchaseForm.requestStage !== "request" ? (
              <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-6">
                <Metric label="총판" value={configuredPurchaseSupplierLabel} />
                <Metric label="요청" value={purchaseRequestedScopeSummary} />
                <Metric label="단가" value={formatPurchaseUnitCost(configuredPurchaseUnitCost, selectedPurchaseTextbook)} />
                <Metric label="합계" value={configuredPurchaseTotalCost > 0 ? formatCurrency(configuredPurchaseTotalCost) : "-"} />
                <Metric
                  label="입고 후"
                  value={purchaseForm.requestStage === "receive" ? `${formatQuantity(purchaseProjectedLocationQuantity)}권` : "-"}
                  tone={purchaseProjectedLocationQuantity < 0 ? "danger" : "default"}
                />
                <Metric label="위치" value={getLocationName(locations, selectedLocationId) || "-"} />
              </div>
            ) : null}
            {purchaseForm.requestStage !== "request" && purchaseFieldVisibility.requester ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {purchaseFieldVisibility.requester ? (
                  <Field label="선생님">
                    <TeacherSelect
                      teachers={data.teacherCatalogs}
                      value={purchaseForm.requestBy}
                      onValueChange={(value) => setPurchaseField("requestBy", value)}
                      ariaLabel={purchaseForm.requestStage === "order" ? "주문 요청자 선택" : "요청자 선택"}
                    />
                  </Field>
                ) : null}
              </div>
            ) : null}
            {purchaseForm.requestStage !== "request" && (purchaseFieldVisibility.location || purchaseFieldVisibility.requestedQuantity) ? (
              <div className="grid gap-3 sm:grid-cols-3">
                {purchaseFieldVisibility.location ? (
                  <Field label="위치">
                    <LocationSelect
                      locations={locations}
                      value={selectedLocationId}
                      onValueChange={(value) => setPurchaseField("locationId", value)}
                      ariaLabel={purchaseForm.requestStage === "order" ? "주문 위치 선택" : "입고 위치 선택"}
                    />
                  </Field>
                ) : null}
                {purchaseFieldVisibility.requestedQuantity ? (
                  <>
                  <Field label="학생용 요청">
                    <Input value={purchaseForm.studentRequestedQuantity} onChange={(event) => setPurchaseField("studentRequestedQuantity", event.target.value)} inputMode="numeric" min="0" aria-label="학생용 요청 수량" />
                  </Field>
                  <Field label="교사용 요청">
                    <Input value={purchaseForm.teacherRequestedQuantity} onChange={(event) => setPurchaseField("teacherRequestedQuantity", event.target.value)} inputMode="numeric" min="0" aria-label="교사용 요청 수량" />
                  </Field>
                  </>
                ) : null}
              </div>
            ) : null}
            {purchaseFieldVisibility.classFit ? (
              <div className="grid grid-cols-4 gap-2 text-sm">
                <Metric label="학생" value={`학생 ${formatQuantity(purchaseClassStudentCount)}명`} />
                <Metric label="학생용" value={`${formatQuantity(purchaseStudentRequestedQuantity)}권`} />
                <Metric label="교사용" value={`${formatQuantity(purchaseTeacherRequestedQuantity)}권`} />
                <Metric label="판단" value={purchaseQuantityFit.label} tone={purchaseQuantityFit.tone} />
              </div>
            ) : null}
            {purchaseFieldVisibility.orderedQuantity || purchaseFieldVisibility.receivedQuantity ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {purchaseFieldVisibility.orderedQuantity ? (
                  <>
                    <Field label="학생용 주문">
                      <Input value={purchaseForm.studentOrderedQuantity} onChange={(event) => setPurchaseField("studentOrderedQuantity", event.target.value)} inputMode="numeric" min="0" aria-label="학생용 주문 수량" />
                    </Field>
                    <Field label="교사용 주문">
                      <Input value={purchaseForm.teacherOrderedQuantity} onChange={(event) => setPurchaseField("teacherOrderedQuantity", event.target.value)} inputMode="numeric" min="0" aria-label="교사용 주문 수량" />
                    </Field>
                  </>
                ) : null}
                {purchaseFieldVisibility.receivedQuantity ? (
                  <>
                    <Field label="학생용 입고">
                      <Input value={purchaseForm.studentReceivedQuantity} onChange={(event) => setPurchaseField("studentReceivedQuantity", event.target.value)} inputMode="numeric" min="0" aria-label="학생용 입고 수량" />
                    </Field>
                    <Field label="교사용 입고">
                      <Input value={purchaseForm.teacherReceivedQuantity} onChange={(event) => setPurchaseField("teacherReceivedQuantity", event.target.value)} inputMode="numeric" min="0" aria-label="교사용 입고 수량" />
                    </Field>
                  </>
                ) : null}
              </div>
            ) : null}
            {purchaseFieldVisibility.statementNumber ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="거래명세표">
                  <Input
                    value={purchaseForm.statementNumber}
                    onChange={(event) => setPurchaseField("statementNumber", event.target.value)}
                    onBlur={() => settlePurchaseTextField("statementNumber")}
                    aria-label="거래명세표"
                  />
                </Field>
                <div className="flex items-end">
                  <Badge variant="outline" className="h-10 w-full justify-center rounded-md text-sm">
                    {purchaseStageLabels[purchaseForm.requestStage]} · 차이 {formatQuantity(purchaseOrderedTotalQuantity - purchaseReceivedTotalQuantity)}
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
              <Button
                type="button"
                variant="outline"
                onClick={closePurchaseDialog}
                aria-label="교재 요청·주문 창 닫기"
                title="닫기"
              >
                닫기
              </Button>
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
              <Button
                type="submit"
                disabled={purchaseSubmitDisabled}
                title={purchaseSubmitDisabled ? "필수 항목을 확인하세요" : purchaseActionLabel(purchaseForm.requestStage)}
              >
                <Truck className="mr-2 size-4" />
                {saving === "purchase" ? "저장 중" : selectedPurchaseLineId ? "선택 건 저장" : purchaseActionLabel(purchaseForm.requestStage)}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      ) : null}

      {bulkOrderDialogOpen ? (
      <Dialog open={bulkOrderDialogOpen} onOpenChange={(open) => (open ? setBulkOrderDialogOpen(true) : closeBulkOrderDialog())}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] overflow-x-hidden overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>선택 요청 일괄 주문</DialogTitle>
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
                    const defaultOrderQuantity = getPositivePurchaseQuantityText(draft.orderedQuantity) || draft.requestedQuantity || "1";
                    return (
                      <TableRow key={lineId}>
                        <TableCell className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <div className="min-w-0 truncate font-medium">{getPurchaseTextbookTitle(line, textbook)}</div>
                            <Badge variant="outline" className="w-fit rounded-md">
                              {getTextbookCopyScopeLabel(draft.copyScope)}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">{getPublisherLabel(textbook || {})}</div>
                        </TableCell>
                        <TableCell className="text-right">{formatQuantity(draft.requestedQuantity)}</TableCell>
                        <TableCell>
                          <Input
                            value={bulkOrderQuantities[lineId] ?? defaultOrderQuantity}
                            onChange={(event) => setBulkOrderQuantity(lineId, event.target.value)}
                            inputMode="numeric"
                            min="1"
                            aria-label={`${getPurchaseTextbookTitle(line, textbook)} ${getTextbookCopyScopeLabel(draft.copyScope)} 주문 수량`}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className={dialogFooterClassName}>
              <Button
                type="button"
                variant="outline"
                onClick={closeBulkOrderDialog}
                aria-label="선택 요청 일괄 주문 창 닫기"
                title="닫기"
              >
                닫기
              </Button>
              <Button type="submit" disabled={saving === "purchase-bulk-order" || selectedBulkOrderLines.length === 0}>
                <Truck className="mr-2 size-4" />
                일괄 주문
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      ) : null}

      {saleDialogOpen ? (
      <Dialog open={saleDialogOpen} onOpenChange={(open) => (open ? setSaleDialogOpen(true) : closeSaleDialog())}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] overflow-x-hidden overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>출고 추가</DialogTitle>
            <DialogDescription className="sr-only">수업 또는 선생님과 교재를 선택해 출고 대기 내역을 생성합니다.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitSale} className="grid min-w-0 max-w-full gap-3 [&>*]:min-w-0 [&>*]:max-w-full" aria-busy={saving === "sale"}>
            <Field label="대상">
              <div className="grid grid-cols-2 rounded-md border bg-background p-0.5" role="group" aria-label="출고 대상">
                {textbookCopyScopeOptions.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={saleCopyScope === option.value ? "default" : "ghost"}
                    size="sm"
                    className="h-8 rounded"
                    aria-pressed={saleCopyScope === option.value}
                    onClick={() => {
                      setSaleField("copyScope", option.value);
                      setExcludedStudentIds([]);
                      setSaleStudentQuery("");
                    }}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              {!isTeacherSale ? (
                <Field label="수업" required>
                  <ClassSelect classes={data.classes} value={saleForm.classId} onValueChange={(value) => {
                    setSaleField("classId", value);
                    setExcludedStudentIds([]);
                    setSaleStudentQuery("");
                  }} />
                </Field>
              ) : (
                <Field label="선생님" required>
                  <TeacherSelect
                    teachers={data.teacherCatalogs}
                    value={saleForm.teacherName}
                    onValueChange={(value) => setSaleField("teacherName", value)}
                    ariaLabel="교사용 수령 선생님 선택"
                  />
                </Field>
              )}
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
            {isTeacherSale ? (
              <Field label="수량" required>
                <Input
                  value={saleForm.quantity}
                  onChange={(event) => setSaleField("quantity", event.target.value)}
                  inputMode="numeric"
                  min="1"
                  aria-label="교사용 출고 수량"
                />
              </Field>
            ) : null}

            {!isTeacherSale ? (
            <div className="rounded-md border">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <span className="text-sm font-medium">학생</span>
                <div className="flex items-center gap-1">
                  {selectedClassStudents.length > 0 ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 rounded-md px-2 text-xs"
                        disabled={excludedSaleStudentCount === 0}
                        aria-label="출고 학생 전체 선택"
                        title="출고 학생 전체 선택"
                        onClick={() => setExcludedStudentIds([])}
                      >
                        전체
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 rounded-md px-2 text-xs"
                        disabled={includedSaleStudentCount === 0}
                        aria-label="출고 학생 전체 해제"
                        title="출고 학생 전체 해제"
                        onClick={() => setExcludedStudentIds(selectedClassStudents.map(getRecordId).filter(Boolean))}
                      >
                        해제
                      </Button>
                    </>
                  ) : null}
                  <Badge variant="secondary" className="rounded-md tabular-nums">
                    {formatQuantity(includedSaleStudentCount)}/{formatQuantity(selectedSaleStudentCount)}명
                  </Badge>
                </div>
              </div>
              {selectedClassStudents.length > 0 ? (
                <div className="border-b p-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="search"
                      value={saleStudentQuery}
                      onChange={(event) => setSaleStudentQuery(normalizeInlineTextInput(event.target.value))}
                      onBlur={() => setSaleStudentQuery((current) => normalizeStoredTextInput(current))}
                      placeholder="학생 검색"
                      aria-label="출고 학생 검색"
                      className="h-8 pl-7 text-sm"
                      autoComplete="off"
                      enterKeyHint="search"
                    />
                  </div>
                  {saleStudentSearchQuery ? (
                    <div className="mt-1 text-xs text-muted-foreground" aria-live="polite">
                      {formatQuantity(visibleIncludedSaleStudentCount)}/{formatQuantity(visibleSaleStudentCount)}명 표시
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="max-h-56 overflow-y-auto p-2">
                {visibleSaleStudents.length > 0 ? visibleSaleStudents.map((student) => {
                  const id = getRecordId(student);
                  const checked = !excludedStudentIds.includes(id);
                  const studentName = getStudentName(student);
                  return (
                    <label key={id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
                      <Checkbox
                        checked={checked}
                        title={`${studentName} 출고 대상 선택`}
                        aria-label={`${studentName} 출고 대상 선택`}
                        onCheckedChange={(value) => {
                          setExcludedStudentIds((current) =>
                            value ? current.filter((item) => item !== id) : [...new Set([...current, id])],
                          );
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate">{studentName}</span>
                    </label>
                  );
                }) : (
                  <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                    {!selectedSaleClass ? "수업을 선택하세요" : !selectedSaleTextbook ? "교재를 선택하세요" : saleStudentSearchQuery ? "검색된 학생이 없습니다" : "대상 학생이 없습니다"}
                  </div>
                )}
              </div>
            </div>
            ) : null}

            <Field label="메모">
              <Textarea
                value={saleForm.memo}
                onChange={(event) => setSaleField("memo", event.target.value)}
                onBlur={settleSaleMemo}
                placeholder="출고 메모"
                aria-label="출고 메모"
                rows={2}
              />
            </Field>

            {!isTeacherSale && saleDuplicateLines.length > 0 ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
                이미 {normalizedSaleChargeMonth}에 같은 수업·교재 출고 {formatQuantity(saleDuplicateStudentCount)}명분이 있습니다.
              </div>
            ) : null}

            {selectedSaleClass || selectedSaleTextbook ? (
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                {isTeacherSale ? (
                  <Metric label="대상" value={saleTeacherName || "선생님 미지정"} />
                ) : (
                  <Metric label="대상" value={`${formatQuantity(includedSaleStudentCount)}명`} />
                )}
                <Metric label="수량" value={`${formatQuantity(saleDraft.totalQuantity)}권`} />
                <Metric label="재고" value={selectedSaleTextbook ? `${formatQuantity(saleDraft.availableQuantity)}권` : "-"} />
                <Metric
                  label="출고 후"
                  value={selectedSaleTextbook ? `${formatQuantity(saleProjectedEndingQuantity)}권` : "-"}
                  tone={saleProjectedEndingQuantity < 0 ? "danger" : "default"}
                />
                <Metric label="청구" value={saleProjectedAmount > 0 ? formatCurrency(saleProjectedAmount) : "-"} />
                <Metric label="부족" value={`${formatQuantity(saleDraft.stockShortage)}권`} tone={saleDraft.hasStockShortage ? "danger" : "default"} />
              </div>
            ) : null}
            <div className={dialogFooterClassName}>
              <Button
                type="button"
                variant="outline"
                onClick={closeSaleDialog}
                aria-label="교재 출고 창 닫기"
                title="닫기"
              >
                닫기
              </Button>
              <Button
                type="submit"
                disabled={schemaDisabled || saving === "sale" || saleSubmitDisabled}
                title={saleSubmitDisabled ? effectiveSaleSubmitHint : "출고 대기 저장"}
              >
                <Check className="mr-2 size-4" />
                {saving === "sale" ? "저장 중" : "출고 대기 저장"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      ) : null}

      {closingDialogOpen ? (
      <Dialog open={closingDialogOpen} onOpenChange={(open) => (open ? setClosingDialogOpen(true) : closeClosingDialog())}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] overflow-x-hidden overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>월마감</DialogTitle>
            <DialogDescription className="sr-only">월별 입고, 출고, 기말 수량과 금액 차이를 정산합니다.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitClosing} className="grid min-w-0 max-w-full gap-3 [&>*]:min-w-0 [&>*]:max-w-full" aria-busy={saving === "closing"}>
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
              <Metric label="저장" value={`${formatQuantity(closingTargetSubjects.length)}건`} />
              <Metric label="입고" value={`${formatQuantity(closingPreview.purchaseQuantity)}권`} />
              <Metric label="출고" value={`${formatQuantity(closingPreview.saleQuantity)}권`} />
              <Metric label="기말" value={`${formatQuantity(closingPreview.endingQuantity)}권`} />
              <Metric label="마진" value={closingNeedsMemo ? "사유 필요" : formatCurrency(closingPreview.textbookMarginAmount)} tone={closingPreview.needsReview ? "danger" : "default"} />
            </div>
            {closingTeamMarginMetrics.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                {closingTeamMarginMetrics.map((item) => (
                  <Metric
                    key={item.team}
                    label={`${getSubjectLabel(item.team)}팀`}
                    value={formatCurrency(item.marginAmount)}
                  />
                ))}
              </div>
            ) : null}
            <Field label="메모">
              <Textarea value={closingForm.memo} onChange={(event) => setClosingForm((current) => ({ ...current, memo: event.target.value }))} rows={3} aria-label="마감 메모" />
            </Field>
            <div className={dialogFooterClassName}>
              <Button
                type="button"
                variant="outline"
                onClick={closeClosingDialog}
                aria-label="월마감 창 닫기"
                title="닫기"
              >
                닫기
              </Button>
              <Button
                type="submit"
                disabled={schemaDisabled || saving === "closing" || closingNeedsMemo}
                title={closingNeedsMemo ? "차이 사유를 메모에 입력하세요" : "월마감 저장"}
              >
                <ClipboardCheck className="mr-2 size-4" />
                {saving === "closing" ? "저장 중" : "마감 저장"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      ) : null}

      <ClosingDetailDialog
        open={Boolean(selectedClosingDetail)}
        row={selectedClosingDetail}
        stockMoves={data.stockMoves}
        textbooks={data.textbooks}
        publishers={data.publishers}
        suppliers={data.suppliers}
        publisherSupplierLinks={data.publisherSupplierLinks}
        locations={locations}
        onOpenChange={(open) => {
          if (!open) setSelectedClosingDetailId("");
        }}
      />

      <Tabs value={activeTab} onValueChange={changeActiveTab} className="min-h-0 min-w-0 flex-1">
        <TabsList
          className={cn(
            "grid h-auto w-full rounded-md border bg-background p-1 shadow-sm",
            canManageTextbookOperations ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" : "grid-cols-1",
          )}
          aria-label="교재관리 업무 탭"
        >
          {canManageTextbookOperations ? (
            <TabsTrigger value="master" className={textbookTabTriggerClassName} aria-label="마스터">
              <BookOpen className="size-4" />
              마스터
              <TabCountBadge value={activeTextbooks.length} />
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="requests" className={textbookTabTriggerClassName} aria-label="요청">
            <Pencil className="size-4" />
            요청
            <TabCountBadge value={operationMetrics.requestCount} />
          </TabsTrigger>
          {canManageTextbookOperations ? (
            <>
              <TabsTrigger value="purchase" className={textbookTabTriggerClassName} aria-label="주문·입고">
                <Truck className="size-4" />
                주문·입고
                <TabCountBadge value={operationMetrics.unregisteredRequestCount + operationMetrics.orderNeededCount + operationMetrics.receivingBacklogCount} />
              </TabsTrigger>
              <TabsTrigger value="sales" className={textbookTabTriggerClassName} aria-label="출고">
                <Check className="size-4" />
                출고
                <TabCountBadge value={operationMetrics.issueWaitingCount} />
              </TabsTrigger>
              <TabsTrigger value="inventory" className={textbookTabTriggerClassName} aria-label="재고">
                <PackageCheck className="size-4" />
                재고
                <TabCountBadge value={activeInventory.length} />
              </TabsTrigger>
              <TabsTrigger value="closing" className={textbookTabTriggerClassName} aria-label="정산">
                <ClipboardCheck className="size-4" />
                정산
                <TabCountBadge value={data.monthlyClosings.length} />
              </TabsTrigger>
            </>
          ) : null}
        </TabsList>

        <TextbookOperationsStatusBar
          items={workspaceStatusItems}
          loading={loading}
          onRefresh={refreshTextbookData}
        />

        {loading ? (
          <TextbookLoadingState />
        ) : (
          <>
        {showsProcessToolbar ? (
          <div className={cn("mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center", !showsProcessSearch && "sm:justify-end")}>
            {showsProcessSearch ? (
              <div className="relative min-w-0 flex-1" role="search" aria-label={operationSearchLabel}>
                <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  ref={operationSearchRef}
                  type="search"
                  value={operationQuery}
                  onChange={(event) => updateOperationSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") updateOperationSearchQuery("");
                  }}
                  className="pl-9 pr-9"
                  placeholder={operationSearchPlaceholder}
                  aria-label={operationSearchLabel}
                  aria-keyshortcuts="/"
                  autoComplete="off"
                  enterKeyHint="search"
                />
                {operationQuery ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1 size-8"
                    aria-label={`${operationSearchLabel} 초기화`}
                    onClick={() => updateOperationSearchQuery("")}
                  >
                    <X className="size-4" />
                  </Button>
                ) : null}
              </div>
            ) : null}
            {canManageTextbookOperations && activeTab !== "requests" ? (
              <TextbookOpsCommandCenter
                metrics={operationMetrics}
                activeQueueKey={activeQueueKey}
                onSelectQueue={openTextbookOpsQueue}
              />
            ) : null}
          </div>
        ) : null}

        {showsInventoryTools ? (
          <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1" role="search" aria-label="교재 검색">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                ref={masterSearchRef}
                type="search"
                value={query}
                onChange={(event) => updateMasterSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") updateMasterSearchQuery("");
                }}
                className="pl-9 pr-9"
                placeholder="교재명, 출판사, ISBN, 바코드"
                aria-label="교재 검색"
                aria-keyshortcuts="/"
                autoComplete="off"
                enterKeyHint="search"
              />
              {query ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1 size-8"
                  aria-label="검색 초기화"
                  onClick={() => updateMasterSearchQuery("")}
                >
                  <X className="size-4" />
                </Button>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {selectedTextbookRows.length > 0 ? (
                <Badge variant="default" className="h-8 rounded-md px-2 tabular-nums">
                  선택 {formatQuantity(selectedTextbookRows.length)}
                </Badge>
              ) : null}
              {canManageTextbookOperations ? (
                <TextbookOpsCommandCenter
                  metrics={operationMetrics}
                  activeQueueKey={activeQueueKey}
                  onSelectQueue={openTextbookOpsQueue}
                />
              ) : null}
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="h-9 rounded-md" aria-label="교재 상태 필터 열기">
                    <SlidersHorizontal className="mr-2 size-3.5" />
                    상태
                    <span className="ml-2 max-w-[10rem] truncate rounded bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
                      {inventoryFilterLabels[inventoryFilter]}
                      {activeTab === "master" ? ` · ${textbookQualityFilterLabels[textbookQualityFilter]}` : ""}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[min(32rem,calc(100vw-2rem))] p-3">
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
                            onClick={() => changeInventoryFilter(filter)}
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
                              onClick={() => changeTextbookQualityFilter(filter)}
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
              {activeTab === "master" && textbookQualityFilter === "inactive" && textbookQualityFilterCounts.inactive > 0 ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="h-9 rounded-md"
                  onClick={emptyInactiveTextbookTrash}
                  disabled={saving === "textbook-trash-empty"}
                >
                  <Trash2 className="mr-2 size-3.5" />
                  비우기
                </Button>
              ) : null}
              {activeTab === "master" && textbookQualityFilterCounts.inactive > 0 ? (
                <Button
                  type="button"
                  variant={textbookQualityFilter === "inactive" ? "default" : "outline"}
                  size="icon"
                  className="relative size-9 rounded-md"
                  aria-pressed={textbookQualityFilter === "inactive"}
                  aria-label="미사용 교재 보관함 열기"
                  title="미사용 교재 보관함"
                  onClick={() => {
                    changeInventoryFilter("all");
                    changeTextbookQualityFilter(textbookQualityFilter === "inactive" ? "all" : "inactive");
                  }}
                >
                  <Trash2 className="size-4" />
                  <span className="sr-only">미사용 교재 보관함 {formatQuantity(textbookQualityFilterCounts.inactive)}개</span>
                  <span className={cn(
                    "absolute -right-1 -top-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums",
                    textbookQualityFilter === "inactive" ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
                  )}>
                    {formatQuantity(textbookQualityFilterCounts.inactive)}
                  </span>
                </Button>
              ) : null}
              {hasTextbookListFilter ? (
                <Button type="button" variant="ghost" size="icon" className="size-9 rounded-md" aria-label="교재 필터 초기화" onClick={resetTextbookListFilters}>
                  <X className="size-4" />
                </Button>
              ) : null}
              {activeTab === "master" ? (
                <Button type="button" className="h-9 shrink-0" aria-label="신규 등록" onClick={openNewMasterDialog}>
                  <Plus className="mr-2 size-4" />
                  신규 등록
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {showsInventoryTools ? (
          <TextbookListControls
            subjectFilter={subjectGroupFilter}
            onSubjectFilterChange={(value) => {
              changeSubjectGroupFilter(value);
            }}
            schoolLevelFilter={schoolLevelGroupFilter}
            onSchoolLevelFilterChange={(value) => {
              changeSchoolLevelGroupFilter(value);
            }}
            gradeLevelFilter={gradeLevelGroupFilter}
            onGradeLevelFilterChange={changeGradeLevelGroupFilter}
            gradeLevelOptions={gradeLevelGroupOptions}
            categoryFilter={categoryGroupFilter}
            onCategoryFilterChange={changeCategoryGroupFilter}
            categoryOptions={categoryGroupOptions}
          />
        ) : null}

        <TabsContent value="master" className="mt-3 grid min-w-0 content-start gap-4">
          <TextbookBulkActionBar
            selectedCount={selectedTextbookRows.length}
            patch={bulkTextbookPatch}
            categoryOptions={bulkCategoryOptions}
            gradeLevelOptions={bulkGradeOptions}
            publisherOptions={publisherGroupOptions}
            saving={saving}
            onPatchChange={setBulkTextbookPatchField}
            onApply={applyBulkTextbookEdit}
            onSetStatus={applyBulkTextbookStatus}
            onDelete={deleteSelectedTextbooks}
            onClear={clearMasterSelection}
          />

          <TextbookTable
            rows={masterVisibleInventory}
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
            emptyActionLabel={hasTextbookListFilter ? "필터 초기화" : "신규 등록"}
            onEmptyAction={hasTextbookListFilter ? resetTextbookListFilters : openNewMasterDialog}
          />
          <div className="flex min-h-9 items-center justify-between gap-2 text-xs text-muted-foreground">
            <span aria-live="polite">{masterVisibleSummary}</span>
            {hasMoreMasterTextbooks ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-md"
                aria-label={`교재 더 보기: ${formatQuantity(remainingMasterTextbookCount)}건 남음`}
                title={`${formatQuantity(remainingMasterTextbookCount)}건 더 보기`}
                onClick={() => setMasterListLimit((current) => current + MASTER_TEXTBOOK_PAGE_SIZE)}
              >
                더 보기 · {formatQuantity(remainingMasterTextbookCount)}건
              </Button>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="requests" className="mt-4 grid min-w-0 content-start gap-4">
          <PurchaseProcessTable
            mode="request"
            orders={data.purchaseOrders}
            lines={activePurchaseOrderLines}
            textbooks={data.textbooks}
            publishers={data.publishers}
            locations={locations}
            suppliers={data.suppliers}
            publisherSupplierLinks={data.publisherSupplierLinks}
            classes={data.classes}
            students={data.students}
            selectedLineId={selectedPurchaseLineId}
            boardScope={purchaseBoardScope}
            requestFilter={purchaseRequestFilter}
            orderFilter={purchaseOrderFilter}
            searchQuery={deferredOperationQuery}
            saving={saving}
            onAddLine={openNewRequestDialog}
            onSelectLine={selectPurchaseLine}
            onRegisterTextbook={openMasterFromPurchaseRequest}
            onScopeChange={setPurchaseBoardScope}
            onRequestFilterChange={setPurchaseRequestFilter}
            onOrderFilterChange={setPurchaseOrderFilter}
            onMoveLine={movePurchaseLine}
            onDeleteLine={deletePurchaseLine}
            onClearSearch={() => updateOperationSearchQuery("")}
          />
        </TabsContent>

        <TabsContent value="purchase" className="mt-4 grid min-w-0 content-start gap-4">
          <PurchaseProcessTable
            mode="order"
            orders={data.purchaseOrders}
            lines={activePurchaseOrderLines}
            textbooks={data.textbooks}
            publishers={data.publishers}
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
            searchQuery={deferredOperationQuery}
            saving={saving}
            onAddLine={openNewPurchaseDialog}
            onSelectLine={selectPurchaseLine}
            onRegisterTextbook={openMasterFromPurchaseRequest}
            onToggleLine={togglePurchaseLineSelection}
            onToggleVisibleLines={toggleVisiblePurchaseLineSelection}
            onBulkOrder={openBulkOrderDialog}
            onBulkReceive={receiveSelectedPurchaseLines}
            onBulkReturn={returnSelectedPurchaseLines}
            onScopeChange={setPurchaseBoardScope}
            onRequestFilterChange={setPurchaseRequestFilter}
            onOrderFilterChange={setPurchaseOrderFilter}
            onMoveLine={movePurchaseLine}
            onDeleteLine={deletePurchaseLine}
            onReturnLine={returnPurchaseLine}
            onClearSearch={() => updateOperationSearchQuery("")}
          />
        </TabsContent>

        <TabsContent value="sales" className="mt-4 grid min-w-0 content-start gap-4">
          <SalesHistoryLedger
            sales={data.sales}
            lines={activeSaleLines}
            textbooks={data.textbooks}
            classes={data.classes}
          />
          <SalesProcessTable
            sales={data.sales}
            lines={activeSaleLines}
            textbooks={data.textbooks}
            classes={data.classes}
            students={data.students}
            locations={locations}
            saving={saving}
            statusFilter={salesProcessFilter}
            searchQuery={deferredOperationQuery}
            selectedLineIds={selectedSaleLineIds}
            canDeleteHistory={canDeleteTextbookHistory}
            onStatusFilterChange={setSalesProcessFilter}
            onAddSale={openNewSaleDialog}
            onUpdateStatus={updateSaleLineStatus}
            onCancelLine={deleteSaleLine}
            onReturnLine={returnSaleLine}
            onDeleteLine={deleteSaleLine}
            onToggleLine={toggleSaleLineSelection}
            onToggleVisibleLines={toggleVisibleSaleLineSelection}
            onBulkIssue={issueSelectedSaleLines}
            onBulkCancel={cancelSelectedSaleLines}
            onBulkReturn={returnSelectedSaleLines}
            onBulkDelete={deleteSelectedSaleHistoryLines}
            onClearSearch={() => updateOperationSearchQuery("")}
          />
        </TabsContent>

        <TabsContent value="inventory" className="mt-4 grid min-w-0 content-start gap-4">
          <InventoryCountWorkspace
            rows={filteredInventory}
            stockCounts={activeStockCounts}
            locations={locations}
            locationId={selectedInventoryCountLocationId}
            auditFilter={inventoryAuditFilter}
            countDrafts={inventoryCountDrafts}
            memoDrafts={inventoryCountMemoDrafts}
            selectedIds={selectedTextbookIds}
            saving={saving}
            schemaDisabled={schemaDisabled}
            collapsedGroups={collapsedTextbookGroups}
            onToggleGroup={toggleTextbookGroup}
            onLocationChange={setInventoryCountLocationId}
            onFilterChange={setInventoryAuditFilter}
            onDraftChange={setInventoryCountDraft}
            onMemoChange={setInventoryCountMemoDraft}
            onClearDraft={clearInventoryCountDraft}
            onSubmitCount={submitInlineStockCount}
            onToggleSelection={toggleTextbookSelection}
            onToggleVisibleSelection={toggleVisibleTextbookIds}
            onSubmitBulkCount={submitBulkInlineStockCounts}
            emptyLabel={textbookEmptyLabel}
          />
          <InventoryHistoryPanel
            stockMoves={activeStockMoves}
            stockCounts={activeStockCounts}
            textbooks={data.textbooks}
            locations={locations}
            currentUserId={currentUserId}
            currentUserLabel={currentUserLabel}
            canDeleteHistory={canDeleteTextbookHistory}
            saving={saving}
            onDeleteHistory={deleteInventoryHistory}
          />
        </TabsContent>

            <TabsContent value="closing" className="mt-4 grid min-w-0 content-start gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="h-8 rounded-md px-2 tabular-nums">
                    마감 {formatQuantity(data.monthlyClosings.length)}건
                  </Badge>
                  <Badge variant="outline" className="h-8 rounded-md px-2 tabular-nums">
                    최근 {formatQuantity(Math.min(data.monthlyClosings.length, 12))}건
                  </Badge>
                </div>
                <Button type="button" onClick={openClosingDialog} aria-label="월마감 추가" title="월마감 추가">
                  <ClipboardCheck className="mr-2 size-4" />
                  월마감 추가
                </Button>
              </div>
              <MonthlyClosingTable
                rows={data.monthlyClosings}
                selectedIds={selectedClosingIds}
                saving={saving}
                onToggleRow={toggleClosingSelection}
                onToggleVisibleRows={toggleVisibleClosingSelection}
                onBulkLock={lockSelectedClosings}
                onInspectRow={(row) => setSelectedClosingDetailId(getRecordId(row))}
              />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}

function Field({ label, children, required = false }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="grid min-w-0 max-w-full gap-1.5 [&>*]:min-w-0 [&>*]:max-w-full">
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
      <div className="mt-1 break-keep text-sm font-semibold leading-tight">{value}</div>
    </div>
  );
}

function TabCountBadge({ value }: { value: number }) {
  if (value <= 0) return null;
  return (
    <Badge variant="secondary" className="ml-1 h-5 rounded px-1.5 text-[11px] leading-none" aria-hidden="true">
      {formatQuantity(value)}
    </Badge>
  );
}

type TextbookOperationsStatusItem = {
  id: string;
  label: string;
  value: string;
  hidden?: boolean;
  tone?: "default" | "danger";
};

function TextbookOperationsStatusBar({
  items,
  loading,
  onRefresh,
}: {
  items: TextbookOperationsStatusItem[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite" aria-label="교재관리 현재 상태">
      {items.map((item) => (
        <Badge
          key={item.id}
          variant={item.tone === "danger" ? "destructive" : "outline"}
          className="h-7 max-w-full rounded-md px-2 font-normal"
        >
          <span className="shrink-0 text-muted-foreground">{item.label}</span>
          <span className="ml-1 max-w-[12rem] truncate font-semibold text-foreground tabular-nums">{item.value}</span>
        </Badge>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-auto h-7 rounded-md px-2"
        onClick={onRefresh}
        disabled={loading}
        aria-label="교재관리 새로고침"
        title="새로고침"
      >
        <RefreshCw className={cn("mr-1 size-3.5", loading && "animate-spin")} />
        새로고침
      </Button>
    </div>
  );
}

function TextbookLoadingState() {
  return (
    <div className="mt-3 grid gap-2 rounded-lg border bg-muted/10 p-3" role="status" aria-live="polite" aria-label="교재관리 로딩">
      <span className="sr-only">교재관리 로딩 중</span>
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <div className="grid gap-2 md:grid-cols-3">
        <div className="h-16 animate-pulse rounded-md bg-muted" />
        <div className="h-16 animate-pulse rounded-md bg-muted" />
        <div className="h-16 animate-pulse rounded-md bg-muted" />
      </div>
    </div>
  );
}

const PURCHASE_ORDER_STANDARD_LOCATIONS = ["본관", "별관"];

function getPurchaseOrderLocations(group: TextbookHandoffGroup) {
  const locationLabels = new Set<string>();

  group.lines.forEach((line) => {
    line.locationQuantities?.forEach((quantity) => {
      if (quantity.locationLabel) {
        locationLabels.add(quantity.locationLabel);
      }
    });
  });

  const standardLocations = PURCHASE_ORDER_STANDARD_LOCATIONS.filter((locationLabel) =>
    locationLabels.has(locationLabel) || locationLabels.size > 0,
  );
  const extraLocations = [...locationLabels].filter((locationLabel) =>
    !PURCHASE_ORDER_STANDARD_LOCATIONS.includes(locationLabel),
  );

  return [...standardLocations, ...extraLocations];
}

function getLocationQuantityForLine(line: TextbookHandoffLine, locationLabel: string) {
  return line.locationQuantities?.find((quantity) => quantity.locationLabel === locationLabel) || {
    locationLabel,
    studentQuantityLabel: "0권",
    teacherQuantityLabel: "0권",
  };
}

function TextbookHandoffDialog({
  open,
  onOpenChange,
  title,
  description,
  groups,
  emptyLabel,
  idPrefix,
  format = "default",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  groups: TextbookHandoffGroup[];
  emptyLabel: string;
  idPrefix: string;
  format?: "default" | "purchase-order" | "purchase-return";
}) {
  const [status, setStatus] = useState("");
  const [manualCopyText, setManualCopyText] = useState("");
  const [preparedDownload, setPreparedDownload] = useState<PreparedHandoffDownload | null>(null);
  const manualCopyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const preparedDownloadRef = useRef<PreparedHandoffDownload | null>(null);
  const documentMeta = getTextbookHandoffDocumentMeta(format);
  const isPurchaseDocument = format === "purchase-order" || format === "purchase-return";
  const allowsTextCopy = !isPurchaseDocument;
  const totalQuantity = groups.reduce((sum, group) => sum + group.totalQuantity, 0);
  const allText = allowsTextCopy ? groups.map((group) => group.message).join("\n\n") : "";
  const allDomId = getHandoffDomId(idPrefix, "all");

  useEffect(() => {
    if (!manualCopyText) {
      return;
    }
    window.requestAnimationFrame(() => {
      manualCopyTextareaRef.current?.focus();
      manualCopyTextareaRef.current?.select();
    });
  }, [manualCopyText]);

  useEffect(() => () => {
    if (preparedDownloadRef.current) {
      URL.revokeObjectURL(preparedDownloadRef.current.url);
    }
  }, []);

  async function runCopyAction(value: string, successStatus: string) {
    try {
      await writeClipboardText(value);
      setManualCopyText("");
      setStatus(successStatus);
    } catch {
      setManualCopyText(value);
      setStatus("복사 권한 없음 · 주문 메시지 선택됨");
    }
  }

  function setNextPreparedDownload(download: PreparedHandoffDownload) {
    if (preparedDownloadRef.current) {
      URL.revokeObjectURL(preparedDownloadRef.current.url);
    }
    preparedDownloadRef.current = download;
    setPreparedDownload(download);
  }

  async function runDownloadAction(action: () => Promise<PreparedHandoffDownload>, successStatus: string) {
    try {
      const download = await action();
      setNextPreparedDownload(download);
      setStatus(successStatus);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "처리 중 오류가 발생했습니다.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      onOpenChange(nextOpen);
      if (!nextOpen) {
        setStatus("");
        setManualCopyText("");
        if (preparedDownloadRef.current) {
          URL.revokeObjectURL(preparedDownloadRef.current.url);
          preparedDownloadRef.current = null;
        }
        setPreparedDownload(null);
      }
    }}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] overflow-hidden sm:max-w-5xl xl:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{description}</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="h-8 rounded-md px-2 tabular-nums">
                {formatQuantity(groups.length)}묶음
              </Badge>
              <Badge variant="outline" className="h-8 rounded-md px-2 tabular-nums">
                {formatQuantity(totalQuantity)}권
              </Badge>
              {status ? (
                <Badge variant="secondary" className="h-8 rounded-md px-2">
                  {status}
                </Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2" data-handoff-toolbar>
              {allowsTextCopy ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={groups.length === 0}
                  onClick={() => runCopyAction(allText, "전체 복사됨")}
                >
                  <Copy className="mr-2 size-3.5" />
                  전체 복사
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={groups.length === 0}
                onClick={() => runDownloadAction(
                  () => downloadHandoffImage(getHandoffCaptureElement(allDomId), title),
                  "전체 이미지 저장됨",
                )}
              >
                <FileImage className="mr-2 size-3.5" />
                전체 이미지
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={groups.length === 0}
                onClick={() => runDownloadAction(
                  () => downloadHandoffPdf(getHandoffCaptureElement(allDomId), title),
                  "PDF 저장됨",
                )}
              >
                <Printer className="mr-2 size-3.5" />
                전체 PDF
              </Button>
            </div>
          </div>

          {allowsTextCopy && manualCopyText ? (
            <div className="grid gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-amber-800">
                <span>자동 복사 제한 · 주문 메시지</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 bg-white"
                  onClick={() => {
                    manualCopyTextareaRef.current?.focus();
                    manualCopyTextareaRef.current?.select();
                  }}
                >
                  전체 선택
                </Button>
              </div>
              <Textarea
                ref={manualCopyTextareaRef}
                readOnly
                aria-label="복사할 주문 메시지"
                className="max-h-40 min-h-24 resize-y bg-white font-mono text-xs"
                value={manualCopyText}
              />
            </div>
          ) : null}

          {preparedDownload ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium text-sky-900">{preparedDownload.label} 파일 준비됨</div>
                <div className="truncate text-xs text-sky-700">{preparedDownload.filename}</div>
              </div>
              <Button type="button" size="sm" variant="outline" className="bg-white" asChild>
                <a href={preparedDownload.url} download={preparedDownload.filename}>
                  <Save className="mr-1 size-3.5" />
                  저장
                </a>
              </Button>
            </div>
          ) : null}

          {groups.length === 0 ? (
            <div className="rounded-md border py-12 text-center text-sm font-medium text-muted-foreground">
              {emptyLabel}
            </div>
          ) : (
            <div id={allDomId} data-handoff-scroll className="max-h-[62dvh] min-h-0 overflow-y-auto pr-1">
              <div data-handoff-capture-target data-handoff-print-root className="grid gap-3 bg-white">
                {groups.map((group) => {
                  const groupDomId = getHandoffDomId(idPrefix, group.id);
                  const filename = `${title}-${group.title}`;
                  const purchaseOrderLocations = isPurchaseDocument ? getPurchaseOrderLocations(group) : [];
                  return (
                    <section key={group.id} className="grid gap-2 rounded-md border bg-background p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2" data-handoff-toolbar>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{group.title}</div>
                          <div className="truncate text-xs text-muted-foreground">{group.summary.join(" · ")}</div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-1">
                          {allowsTextCopy ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8"
                              onClick={() => runCopyAction(group.message, "복사됨")}
                            >
                              <Copy className="mr-1 size-3.5" />
                              복사
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={() => runDownloadAction(
                              () => downloadHandoffImage(getHandoffCaptureElement(groupDomId), filename),
                              "이미지 저장됨",
                            )}
                          >
                            <FileImage className="mr-1 size-3.5" />
                            이미지 저장
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={() => runDownloadAction(
                              () => downloadHandoffPdf(getHandoffCaptureElement(groupDomId), filename),
                              "PDF 저장됨",
                            )}
                          >
                            <Printer className="mr-1 size-3.5" />
                            PDF 저장
                          </Button>
                        </div>
                      </div>

                      <div id={groupDomId} data-handoff-card data-handoff-capture-target data-handoff-print-root className="rounded-md bg-white p-4 text-slate-950">
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
                          <div className="min-w-0">
                            {isPurchaseDocument ? (
                              <div className="mb-1 text-xs font-semibold uppercase tracking-normal text-slate-500">
                                {documentMeta.documentTitle}
                              </div>
                            ) : null}
                            <div className="text-base font-semibold">{group.title}</div>
                            {group.subtitle ? <div className="mt-1 text-xs text-slate-500">{group.subtitle}</div> : null}
                          </div>
                          <div className="flex flex-wrap justify-end gap-1 text-xs">
                            {group.summary.map((item) => (
                              <span key={item} className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-medium tabular-nums">
                                {item}
                              </span>
                            ))}
                          </div>
                        </div>
                        {isPurchaseDocument ? (
                          <div className="grid gap-2 border-b py-3 text-sm sm:grid-cols-3">
                            <div className="rounded-md bg-slate-50 px-3 py-2">
                              <div className="text-[11px] font-medium text-slate-500">문서일자</div>
                              <div className="mt-1 font-semibold text-slate-950">{documentMeta.documentDate}</div>
                            </div>
                            <div className="rounded-md bg-slate-50 px-3 py-2">
                              <div className="text-[11px] font-medium text-slate-500">내용</div>
                              <div className="mt-1 font-semibold text-slate-950">{documentMeta.contentLabel}</div>
                            </div>
                            <div className="rounded-md bg-slate-50 px-3 py-2">
                              <div className="text-[11px] font-medium text-slate-500">발신</div>
                              <div className="mt-1 font-semibold text-slate-950">
                                {TEXTBOOK_HANDOFF_BUSINESS_NAME}
                              </div>
                            </div>
                          </div>
                        ) : null}
                        <div className="mt-3 overflow-hidden rounded-md border border-slate-200">
                          <Table>
                            {isPurchaseDocument ? (
                              <>
                                <TableHeader>
                                  <TableRow className="bg-slate-50">
                                    <TableHead rowSpan={2} className="min-w-[240px] text-slate-600">교재명</TableHead>
                                    {purchaseOrderLocations.map((locationLabel) => (
                                      <TableHead
                                        key={locationLabel}
                                        colSpan={2}
                                        className="border-l border-slate-200 text-center text-slate-700"
                                      >
                                        {locationLabel}
                                      </TableHead>
                                    ))}
                                    <TableHead rowSpan={2} className="w-[112px] text-right text-slate-600">매입 단가</TableHead>
                                    <TableHead rowSpan={2} className="w-[112px] text-right text-slate-600">
                                      {format === "purchase-return" ? "반품 금액" : "주문 금액"}
                                    </TableHead>
                                  </TableRow>
                                  <TableRow className="bg-slate-50">
                                    {purchaseOrderLocations.map((locationLabel) => (
                                      <Fragment key={`${locationLabel}-scopes`}>
                                        <TableHead className="w-[76px] border-l border-slate-200 text-right text-sky-700">학생용</TableHead>
                                        <TableHead className="w-[76px] text-right text-amber-700">교사용</TableHead>
                                      </Fragment>
                                    ))}
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {group.lines.map((line) => (
                                    <TableRow key={line.id} className="align-top">
                                      <TableCell>
                                        <div className="font-semibold text-slate-950">{line.title}</div>
                                        <div className="mt-1 flex flex-wrap gap-1 text-xs text-slate-500">
                                          {line.publisherLabel ? (
                                            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                                              {line.publisherLabel}
                                            </span>
                                          ) : null}
                                          {line.note ? (
                                            <span className="rounded-full bg-slate-50 px-2 py-0.5">
                                              {line.note}
                                            </span>
                                          ) : null}
                                        </div>
                                      </TableCell>
                                      {purchaseOrderLocations.map((locationLabel) => {
                                        const quantity = getLocationQuantityForLine(line, locationLabel);
                                        return (
                                          <Fragment key={`${line.id}-${locationLabel}`}>
                                            <TableCell className="border-l border-slate-200 bg-sky-50/70 text-right font-semibold tabular-nums text-sky-900">
                                              <span className="inline-flex rounded-full bg-white px-2 py-0.5 ring-1 ring-sky-200">
                                                {quantity.studentQuantityLabel}
                                              </span>
                                            </TableCell>
                                            <TableCell className="bg-amber-50/70 text-right font-semibold tabular-nums text-amber-900">
                                              <span className="inline-flex rounded-full bg-white px-2 py-0.5 ring-1 ring-amber-200">
                                                {quantity.teacherQuantityLabel}
                                              </span>
                                            </TableCell>
                                          </Fragment>
                                        );
                                      })}
                                      <TableCell className="text-right tabular-nums text-slate-700">{line.unitCostLabel || "-"}</TableCell>
                                      <TableCell className="text-right font-semibold tabular-nums text-slate-950">{line.amountLabel}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </>
                            ) : (
                              <>
                                <TableHeader>
                                  <TableRow className="bg-slate-50">
                                    <TableHead className="text-slate-600">항목</TableHead>
                                    <TableHead className="text-slate-600">대상</TableHead>
                                    <TableHead className="w-20 text-right text-slate-600">수량</TableHead>
                                    <TableHead className="w-24 text-right text-slate-600">금액</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {group.lines.map((line) => (
                                    <TableRow key={line.id}>
                                      <TableCell>
                                        <div className="font-medium text-slate-950">{line.title}</div>
                                        {line.note ? <div className="text-xs text-slate-500">{line.note}</div> : null}
                                      </TableCell>
                                      <TableCell className="text-slate-700">{line.detail || "-"}</TableCell>
                                      <TableCell className="text-right tabular-nums text-slate-700">{line.quantityLabel}</TableCell>
                                      <TableCell className="text-right tabular-nums text-slate-950">{line.amountLabel}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </>
                            )}
                          </Table>
                        </div>
                        {isPurchaseDocument ? (
                          <div className="mt-4 flex items-end justify-between gap-3 border-t pt-3 text-sm">
                            <div className="text-xs text-slate-500">
                              {documentMeta.contentLabel} 내용 확인 후 회신 부탁드립니다.
                            </div>
                            <div className="text-right">
                              <div className="text-[11px] font-medium text-slate-500">발신</div>
                              <div className="text-base font-semibold text-slate-950">{documentMeta.businessName}</div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type SearchSelectOption = {
  value: string;
  label: string;
  description?: string;
  searchText?: string;
  metaRows?: SearchSelectMetaRow[];
  filterValues?: Record<string, SearchSelectFilterValue[]>;
};

type SearchSelectMetaRow = {
  label: string;
  value: string;
};

type SearchSelectFilterValue = {
  value: string;
  label: string;
};

type SearchSelectFilterOption = SearchSelectFilterValue & {
  count: number;
};

type SearchSelectFilterLayout = "default" | "subject-grade-teacher" | "subject-grade-detail";

type SearchSelectFilterGroupConfig = {
  key: string;
  label: string;
  optionOrder?: string[];
};

type SearchSelectFilterGroup = {
  key: string;
  label: string;
  optionOrder?: string[];
  options: SearchSelectFilterOption[];
};

function SearchCombobox({
  options,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  ariaLabel,
  triggerLabel,
  triggerClassName,
  contentClassName,
  allowDeselect = false,
  filterGroups = [],
  filterLayout = "default",
}: {
  options: SearchSelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  ariaLabel: string;
  triggerLabel?: string;
  triggerClassName?: string;
  contentClassName?: string;
  allowDeselect?: boolean;
  filterGroups?: SearchSelectFilterGroup[];
  filterLayout?: SearchSelectFilterLayout;
}) {
  const [open, setOpen] = useState(false);
  const [selectedFilterValues, setSelectedFilterValues] = useState<Record<string, string[]>>({});
  const selected = options.find((option) => option.value === value);
  const activeFilterCount = filterGroups.reduce((sum, group) => {
    const validValues = new Set(group.options.map((option) => option.value));
    return sum + (selectedFilterValues[group.key] || []).filter((value) => validValues.has(value)).length;
  }, 0);
  const visibleFilterGroups = buildVisibleSearchSelectFilterGroups(options, filterGroups, selectedFilterValues);
  const filteredOptions = filterGroups.length === 0
    ? options
    : options.filter((option) => doesSearchOptionMatchFilters(option, filterGroups, selectedFilterValues));
  const usesTwoColumnFilterLayout = filterLayout === "subject-grade-teacher" || filterLayout === "subject-grade-detail";
  const shouldInlineFilterReset = usesTwoColumnFilterLayout && activeFilterCount > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn("w-full justify-between gap-2 px-3 font-normal", triggerClassName)}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            {triggerLabel ? <span className="shrink-0 text-xs font-medium text-muted-foreground">{triggerLabel}</span> : null}
            <span className={cn("min-w-0 truncate", !selected && "text-muted-foreground")}>
              {selected?.label || placeholder}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-[min(640px,calc(100vw-2rem))] p-0", contentClassName)}
        align="start"
        onWheelCapture={(event) => event.stopPropagation()}
        onTouchMoveCapture={(event) => event.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          {visibleFilterGroups.length > 0 ? (
            <div className="grid gap-2 border-b px-2 py-2">
              {!usesTwoColumnFilterLayout && activeFilterCount > 0 ? (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-md px-2 text-xs"
                    onClick={() => setSelectedFilterValues({})}
                    aria-label={`${ariaLabel} 필터 초기화`}
                  >
                    필터 초기화
                  </Button>
                </div>
              ) : null}
              <div
                className={cn(
                  "grid max-h-36 gap-2 overflow-y-auto pr-1",
                  usesTwoColumnFilterLayout && "grid-cols-2 items-start",
                  shouldInlineFilterReset && "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]",
                )}
              >
                {visibleFilterGroups.map((group) => (
                  <Fragment key={group.key}>
                    <div
                      className={cn(
                        "grid gap-1",
                        usesTwoColumnFilterLayout && !["subject", "grade"].includes(group.key) && (shouldInlineFilterReset ? "col-span-3" : "col-span-2"),
                      )}
                    >
                      <div className="text-[11px] font-medium text-muted-foreground">{group.label}</div>
                      <div className="flex flex-wrap gap-1">
                        {group.options.map((option) => {
                          const isFilterSelected = (selectedFilterValues[group.key] || []).includes(option.value);
                          return (
                            <button
                              key={`${group.key}-${option.value}`}
                              type="button"
                              className={cn(
                                "inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-1 text-[11px] leading-none transition",
                                isFilterSelected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                              )}
                              aria-pressed={isFilterSelected}
                              aria-label={`${ariaLabel} ${group.label} ${option.label} 필터`}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setSelectedFilterValues((current) => toggleSearchSelectFilter(current, group.key, option.value));
                              }}
                            >
                              <span className="min-w-0 truncate">{option.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {group.key === "grade" && shouldInlineFilterReset ? (
                      <div className="flex items-end justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-md px-2 text-xs"
                          onClick={() => setSelectedFilterValues({})}
                          aria-label={`${ariaLabel} 필터 초기화`}
                        >
                          필터 초기화
                        </Button>
                      </div>
                    ) : null}
                  </Fragment>
                ))}
              </div>
            </div>
          ) : null}
          <CommandList
            className="max-h-80 overscroll-contain overflow-y-auto"
            onWheelCapture={(event) => event.stopPropagation()}
            onTouchMoveCapture={(event) => event.stopPropagation()}
          >
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  value={buildSearchSelectCommandValue(option)}
                  className="items-start gap-2 py-2"
                  onSelect={() => {
                    onValueChange(allowDeselect && option.value === value ? "" : option.value);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mt-0.5 size-4 shrink-0", option.value === value ? "opacity-100" : "opacity-0")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{option.label}</span>
                      {option.description ? (
                        <span className="shrink-0 text-xs text-muted-foreground">{option.description}</span>
                      ) : null}
                    </div>
                    {option.metaRows?.length ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {option.metaRows.map((row) => (
                          <span
                            key={`${row.label}-${row.value}`}
                            className="inline-flex max-w-full items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-[11px] leading-none"
                          >
                            <span className="shrink-0 font-medium text-muted-foreground">{row.label}</span>
                            <span className="min-w-0 truncate text-foreground">{row.value}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function toggleSearchSelectFilter(current: Record<string, string[]>, groupKey: string, optionValue: string) {
  const currentValues = current[groupKey] || [];
  const nextValues = currentValues.includes(optionValue)
    ? currentValues.filter((value) => value !== optionValue)
    : [...currentValues, optionValue];
  const next = { ...current };
  if (nextValues.length > 0) {
    next[groupKey] = nextValues;
  } else {
    delete next[groupKey];
  }
  return next;
}

function doesSearchOptionMatchFilters(
  option: SearchSelectOption,
  filterGroups: SearchSelectFilterGroup[],
  selectedFilterValues: Record<string, string[]>,
) {
  for (const group of filterGroups) {
    const selectedValues = selectedFilterValues[group.key] || [];
    if (selectedValues.length === 0) continue;
    const optionValues = new Set((option.filterValues?.[group.key] || []).map((item) => item.value));
    if (!selectedValues.some((value) => optionValues.has(value))) return false;
  }
  return true;
}

function buildSearchSelectCommandValue(option: SearchSelectOption) {
  return [
    option.label,
    option.description,
    option.searchText,
    option.value,
    ...(option.metaRows || []).flatMap((row) => [row.label, row.value]),
    ...Object.values(option.filterValues || {}).flatMap((values) => values.flatMap((row) => [row.label, row.value])),
  ].map(text).join(" ");
}

function buildSearchSelectMetaRows(rows: Array<SearchSelectMetaRow | null | undefined>) {
  return rows.filter((row): row is SearchSelectMetaRow => Boolean(row && text(row.value)));
}

function buildSearchSelectFilterValue(value: unknown, label = value): SearchSelectFilterValue | null {
  const normalizedValue = text(value);
  const normalizedLabel = text(label) || normalizedValue;
  return normalizedValue ? { value: normalizedValue, label: normalizedLabel } : null;
}

function isSearchSelectFilterValue(value: unknown): value is SearchSelectFilterValue {
  return Boolean(value && typeof value === "object" && "value" in value && "label" in value);
}

function buildSearchSelectFilterValues(values: Array<unknown | SearchSelectFilterValue | null | undefined>) {
  const valuesByKey = new Map<string, SearchSelectFilterValue>();
  for (const value of values) {
    const filterValue = isSearchSelectFilterValue(value)
      ? buildSearchSelectFilterValue(value.value, value.label)
      : buildSearchSelectFilterValue(value);
    if (!filterValue || valuesByKey.has(filterValue.value)) continue;
    valuesByKey.set(filterValue.value, filterValue);
  }
  return [...valuesByKey.values()];
}

function collectSearchSelectFilterOptions(options: SearchSelectOption[], groupKey: string) {
  const optionCounts = new Map<string, SearchSelectFilterOption>();
  for (const option of options) {
    const countedOptionValues = new Set<string>();
    for (const filterValue of option.filterValues?.[groupKey] || []) {
      if (countedOptionValues.has(filterValue.value)) continue;
      countedOptionValues.add(filterValue.value);
      const existing = optionCounts.get(filterValue.value);
      optionCounts.set(filterValue.value, {
        value: filterValue.value,
        label: existing?.label || filterValue.label,
        count: (existing?.count || 0) + 1,
      });
    }
  }
  return [...optionCounts.values()];
}

function sortSearchSelectFilterOptions(options: SearchSelectFilterOption[], optionOrder: string[] = []) {
  return [...options].sort((left, right) => {
    const leftOrder = optionOrder.indexOf(left.label);
    const rightOrder = optionOrder.indexOf(right.label);
    if (leftOrder !== -1 || rightOrder !== -1) {
      if (leftOrder === -1) return 1;
      if (rightOrder === -1) return -1;
      return leftOrder - rightOrder;
    }
    return left.label.localeCompare(right.label, "ko", { numeric: true });
  });
}

function buildSearchSelectFilterGroups(
  options: SearchSelectOption[],
  groups: SearchSelectFilterGroupConfig[],
): SearchSelectFilterGroup[] {
  return groups.map((group) => {
    return {
      key: group.key,
      label: group.label,
      optionOrder: group.optionOrder,
      options: sortSearchSelectFilterOptions(collectSearchSelectFilterOptions(options, group.key), group.optionOrder),
    };
  }).filter((group) => group.options.length > 0);
}

function buildVisibleSearchSelectFilterGroups(
  options: SearchSelectOption[],
  filterGroups: SearchSelectFilterGroup[],
  selectedFilterValues: Record<string, string[]>,
) {
  return filterGroups.map((group) => {
    const selectedPeerFilterValues = { ...selectedFilterValues };
    delete selectedPeerFilterValues[group.key];
    const scopedOptions = options.filter((option) => (
      doesSearchOptionMatchFilters(option, filterGroups, selectedPeerFilterValues)
    ));
    return {
      ...group,
      options: sortSearchSelectFilterOptions(collectSearchSelectFilterOptions(scopedOptions, group.key), group.optionOrder),
    };
  }).filter((group) => group.options.length > 0);
}

const textbookNonSubSubjectFilterLabels = new Set([
  ...TEXTBOOK_GRADE_OPTIONS.map((option) => option.label),
  ...TEXTBOOK_SCHOOL_LEVEL_OPTIONS.map((option) => option.label),
]);

function getTextbookSelectSubSubject(textbook: Row) {
  const subSubject = getTextbookSubSubject(textbook);
  return textbookNonSubSubjectFilterLabels.has(subSubject) ? "" : subSubject;
}

function buildTextbookSelectMetaRows(textbook: Row) {
  const schoolLevel = getTextbookSchoolLevelLabel(getTextbookSchoolLevel(textbook));
  const grade = getTextbookGradeLabel(getTextbookGradeLevel(textbook));
  const subSubject = getTextbookSelectSubSubject(textbook);
  const categoryDetail = compactUniqueLabels([schoolLevel, grade, subSubject]).join(" · ");

  return buildSearchSelectMetaRows([
    { label: "출판사", value: getPublisherLabel(textbook) },
    { label: "구분", value: categoryDetail || getTaxonomyCategoryLabel(textbook) },
    { label: "ISBN", value: text(textbook.isbn13) },
    { label: "바코드", value: text(textbook.barcode) },
  ]);
}

function TextbookSelect({ textbooks, value, onValueChange }: { textbooks: Row[]; value: string; onValueChange: (value: string) => void }) {
  const options = textbooks.map((textbook) => ({
    value: getRecordId(textbook),
    label: getTextbookTitle(textbook),
    description: getSubjectLabel(textbook.subject),
    metaRows: buildTextbookSelectMetaRows(textbook),
    filterValues: {
      subject: buildSearchSelectFilterValues([getSubjectLabel(textbook.subject)]),
      grade: buildSearchSelectFilterValues([getTextbookGradeLabel(getTextbookGradeLevel(textbook))]),
      subSubject: buildSearchSelectFilterValues([getTextbookSelectSubSubject(textbook)]),
    },
    searchText: [
      normalizeTextbookLookupValue(getTextbookTitle(textbook), { compact: true }),
      textbook.publisher,
      textbook.category,
      getTaxonomyCategoryLabel(textbook),
      getTextbookSchoolLevelLabel(getTextbookSchoolLevel(textbook)),
      getTextbookGradeLabel(getTextbookGradeLevel(textbook)),
      getTextbookSelectSubSubject(textbook),
      textbook.isbn13,
      textbook.barcode,
    ].map(text).join(" "),
  }));
  const textbookSelectFilterGroups = buildSearchSelectFilterGroups(options, [
    { key: "subject", label: "과목", optionOrder: ["영어", "수학", "기타"] },
    { key: "grade", label: "학년" },
    { key: "subSubject", label: "세부과목" },
  ]);

  return (
    <SearchCombobox
      options={options}
      value={value}
      onValueChange={onValueChange}
      placeholder="교재 선택"
      searchPlaceholder="교재명, 출판사, ISBN"
      emptyLabel="교재가 없습니다"
      ariaLabel="교재 선택"
      filterGroups={textbookSelectFilterGroups}
      filterLayout="subject-grade-detail"
    />
  );
}

function getClassTeacherLabel(classItem: Row) {
  return splitTeacherNames(
    classItem.teacher ||
      classItem.teacher_name ||
      classItem.teacherName ||
      classItem.teacher_names ||
      classItem.teacherNames,
  ).join(", ");
}

function getClassClassroomSelectLabel(classItem: Row) {
  return text(
    classItem.classroom ||
      classItem.classroom_name ||
      classItem.classroomName ||
      classItem.room ||
      classItem.location ||
      classItem.location_name ||
      classItem.locationName,
  );
}

function getClassSubjectLabel(classItem: Row) {
  const subject = text(classItem.subject || classItem.subject_name || classItem.subjectName || classItem.course || classItem.courseName);
  const normalized = subjectAliases[subject] || subjectAliases[subject.toLowerCase()];
  return normalized ? subjectOptions.find((option) => option.value === normalized)?.label || subject : subject;
}

function getClassGradeSelectLabel(classItem: Row) {
  return text(classItem.grade || classItem.grade_label || classItem.gradeLabel || classItem.school_grade || classItem.schoolGrade);
}

function getClassStudentCountSelectValue(classItem: Row) {
  const studentIds = listIds(classItem.student_ids || classItem.studentIds);
  return studentIds.length || numberValue(classItem.student_count || classItem.studentCount || classItem.enrollment_count || classItem.enrollmentCount);
}

function getClassStatusLabel(classItem: Row) {
  const status = text(classItem.status || classItem.class_status || classItem.classStatus);
  if (!status) return "";
  const normalized = statusAliases[status] || statusAliases[status.toLowerCase()];
  return statusOptions.find((option) => option.value === normalized)?.label || status;
}

function getClassScheduleLabel(classItem: Row) {
  return text(
    classItem.schedule ||
      classItem.schedule_summary ||
      classItem.scheduleSummary ||
      classItem.class_time ||
      classItem.classTime ||
      classItem.time,
  );
}

function buildClassSelectMetaRows(classItem: Row) {
  const studentCount = getClassStudentCountSelectValue(classItem);
  return buildSearchSelectMetaRows([
    { label: "선생님", value: getClassTeacherLabel(classItem) },
    { label: "강의실", value: getClassClassroomSelectLabel(classItem) },
    { label: "학생", value: studentCount > 0 ? `${formatQuantity(studentCount)}명` : "" },
    { label: "시간", value: getClassScheduleLabel(classItem) },
  ]);
}

function ClassSelect({ classes, value, onValueChange }: { classes: Row[]; value: string; onValueChange: (value: string) => void }) {
  const options = classes.map((classItem) => ({
    value: getRecordId(classItem),
    label: getClassName(classItem),
    description: compactUniqueLabels([getClassSubjectLabel(classItem), getClassGradeSelectLabel(classItem)]).join(" · "),
    metaRows: buildClassSelectMetaRows(classItem),
    filterValues: {
      subject: buildSearchSelectFilterValues([getClassSubjectLabel(classItem)]),
      grade: buildSearchSelectFilterValues([getClassGradeSelectLabel(classItem)]),
      teacher: buildSearchSelectFilterValues(splitTeacherNames(getClassTeacherLabel(classItem))),
    },
    searchText: [
      classItem.teacher,
      classItem.teacher_name,
      classItem.teacherName,
      getClassSubjectLabel(classItem),
      getClassGradeSelectLabel(classItem),
      getClassStatusLabel(classItem),
      getClassScheduleLabel(classItem),
    ].map(text).join(" "),
  }));
  const classSelectFilterGroups = buildSearchSelectFilterGroups(options, [
    { key: "subject", label: "과목", optionOrder: ["영어", "수학", "기타"] },
    { key: "grade", label: "학년" },
    { key: "teacher", label: "선생님" },
  ]);

  return (
    <SearchCombobox
      options={options}
      value={value}
      onValueChange={onValueChange}
      placeholder="수업 선택"
      searchPlaceholder="수업명, 담당"
      emptyLabel="수업이 없습니다"
      ariaLabel="수업 선택"
      allowDeselect={true}
      filterGroups={classSelectFilterGroups}
      filterLayout="subject-grade-teacher"
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
}) {
  const subjectSelectOptions = [
    { value: "all", label: "전체 과목" },
    ...subjectOptions,
  ];
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

  return (
    <div className="mt-2 grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4" aria-label="교재 마스터 필터">
      <div className="min-w-0">
        <SearchCombobox
          options={subjectSelectOptions}
          value={subjectFilter}
          onValueChange={onSubjectFilterChange}
          placeholder="전체 과목"
          searchPlaceholder="과목 검색"
          emptyLabel="과목이 없습니다"
          ariaLabel="교재 과목 필터"
          triggerLabel="과목"
          triggerClassName="h-8 rounded-md"
          contentClassName="w-[min(18rem,calc(100vw-2rem))]"
        />
      </div>
      <div className="min-w-0">
        <SearchCombobox
          options={categorySelectOptions}
          value={categoryFilter}
          onValueChange={onCategoryFilterChange}
          placeholder="전체 세부과목"
          searchPlaceholder="세부과목 검색"
          emptyLabel="세부과목이 없습니다"
          ariaLabel="교재 세부과목 필터"
          triggerLabel="세부과목"
          triggerClassName="h-8 rounded-md"
          contentClassName="w-[min(22rem,calc(100vw-2rem))]"
        />
      </div>
      <div className="min-w-0">
        <SearchCombobox
          options={schoolLevelSelectOptions}
          value={schoolLevelFilter}
          onValueChange={onSchoolLevelFilterChange}
          placeholder="전체 학교 구분"
          searchPlaceholder="학교 구분 검색"
          emptyLabel="학교 구분이 없습니다"
          ariaLabel="교재 학교 구분 필터"
          triggerLabel="학교"
          triggerClassName="h-8 rounded-md"
          contentClassName="w-[min(18rem,calc(100vw-2rem))]"
        />
      </div>
      <div className="min-w-0">
        <SearchCombobox
          options={gradeLevelSelectOptions}
          value={gradeLevelFilter}
          onValueChange={onGradeLevelFilterChange}
          placeholder="전체 학년"
          searchPlaceholder="학년 검색"
          emptyLabel="학년이 없습니다"
          ariaLabel="교재 학년 필터"
          triggerLabel="학년"
          triggerClassName="h-8 rounded-md"
          contentClassName="w-[min(18rem,calc(100vw-2rem))]"
        />
      </div>
    </div>
  );
}

function TextbookBulkActionBar({
  selectedCount,
  patch,
  categoryOptions,
  gradeLevelOptions,
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
  gradeLevelOptions: typeof TEXTBOOK_GRADE_OPTIONS;
  publisherOptions: string[];
  saving: string;
  onPatchChange: (name: keyof typeof emptyBulkTextbookPatch, value: string) => void;
  onApply: () => void;
  onSetStatus: (status: string) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [bulkPatchControlsOpen, setBulkPatchControlsOpen] = useState(false);

  if (selectedCount === 0) {
    return null;
  }

  const hasPatch =
    patch.subject !== "keep" ||
    patch.schoolLevel !== "keep" ||
    patch.gradeLevel !== "keep" ||
    Boolean(text(patch.category)) ||
    Boolean(text(patch.publisher)) ||
    Boolean(text(patch.price)) ||
    patch.status !== "keep";
  const showPatchControls = bulkPatchControlsOpen || hasPatch;
  const patchControlsId = "textbook-bulk-patch-controls";

  return (
    <div
      className="sticky bottom-3 z-20 grid gap-2 rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur"
      role="region"
      aria-label="선택한 교재 일괄 작업"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex h-9 items-center gap-2 text-sm font-medium">
          <Badge variant="secondary" className="tabular-nums" title="현재 목록에서 선택한 교재 수">{formatQuantity(selectedCount)}개 선택</Badge>
          {hasPatch ? <Badge variant="outline" className="tabular-nums">변경 준비</Badge> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant={showPatchControls ? "default" : "outline"}
            className="h-9"
            aria-expanded={showPatchControls}
            aria-controls={patchControlsId}
            onClick={() => setBulkPatchControlsOpen((current) => !current)}
          >
            <Pencil className="mr-2 size-4" />
            속성 변경
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-9" disabled={saving === "textbook-bulk-status"} aria-label="선택 교재 사용 전환" onClick={() => onSetStatus("active")}>
            <Check className="mr-2 size-4" />
            사용 전환
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-9" disabled={saving === "textbook-bulk-status"} aria-label="선택 교재 미사용 처리" onClick={() => onSetStatus("inactive")}>
            <X className="mr-2 size-4" />
            미사용 처리
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="h-9"
            disabled={saving === "textbook-bulk-delete"}
            aria-label="선택 교재 삭제"
            title="이력이 없는 교재는 삭제, 이력이 있는 교재는 미사용 전환"
            onClick={onDelete}
          >
            <Trash2 className="mr-2 size-4" />
            삭제
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-9"
            aria-label="선택 교재 선택 해제"
            title="선택 해제"
            onClick={onClear}
          >
            선택 해제
          </Button>
        </div>
      </div>
      {showPatchControls ? (
        <div id={patchControlsId} className="grid min-w-0 gap-2 border-t pt-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-[repeat(7,minmax(0,1fr))_auto]">
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
          <Field label="학교">
            <Select value={patch.schoolLevel} onValueChange={(value) => onPatchChange("schoolLevel", value)}>
              <SelectTrigger className="h-9" aria-label="일괄 학교 구분 선택"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="keep">학교 유지</SelectItem>
                <SelectItem value="none">미지정</SelectItem>
                {TEXTBOOK_SCHOOL_LEVEL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="학년">
            <Select value={patch.gradeLevel} onValueChange={(value) => onPatchChange("gradeLevel", value)}>
              <SelectTrigger className="h-9" aria-label="일괄 학년 선택"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="keep">학년 유지</SelectItem>
                <SelectItem value="none">미지정</SelectItem>
                {gradeLevelOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="세부과목">
            <SearchCombobox
              options={[
                { value: "", label: "세부과목 유지" },
                ...categoryOptions.map((category) => ({ value: category, label: category })),
              ]}
              value={patch.category}
              onValueChange={(value) => onPatchChange("category", value)}
              placeholder="세부과목 유지"
              searchPlaceholder="세부과목 검색"
              emptyLabel="세부과목이 없습니다"
              ariaLabel="일괄 세부과목"
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
          <Field label="판매가">
            <Input value={patch.price} onChange={(event) => onPatchChange("price", normalizeMoneyInput(event.target.value))} placeholder="예: 12000" className="h-9" inputMode="numeric" pattern="[0-9]*" aria-label="일괄 판매가" />
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
          <div className="flex items-end">
            <Button type="button" size="sm" className="h-9 w-full" title={hasPatch ? "선택 교재에 변경사항 적용" : "변경할 값을 먼저 선택하세요"} disabled={!hasPatch || saving === "textbook-bulk-edit"} onClick={onApply}>
              <Save className="mr-2 size-4" />
              적용
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getInventoryCountStatusClassName(row: InventoryCountRow) {
  if (row.status === "done") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (row.isRecommended) return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function getInventoryCountReasonLabel(row: InventoryCountRow) {
  const latestLabel = row.latestCountAt ? `최근 실사 ${formatCompactDateTime(row.latestCountAt)}` : "실사 이력 없음";
  return compactUniqueLabels([latestLabel, row.reason, row.dueLabel]).join(" · ");
}

function getInventoryCountSubmitLabel({
  row,
  draftValue,
  isSaving,
  schemaDisabled,
}: {
  row: InventoryCountRow;
  draftValue: string;
  isSaving: boolean;
  schemaDisabled: boolean;
}) {
  const scopeLabel = `${row.title} ${row.locationName}`;
  if (schemaDisabled) return "실사 반영 불가";
  if (isSaving) return `${scopeLabel} 반영 중`;
  if (!text(draftValue)) return `${scopeLabel} 실사 수량 입력 필요`;
  return `${scopeLabel} ${formatQuantity(draftValue)}권 반영`;
}

function InventoryCountWorkspace({
  rows,
  stockCounts,
  locations,
  locationId,
  auditFilter,
  countDrafts,
  memoDrafts,
  selectedIds = [],
  saving,
  schemaDisabled,
  collapsedGroups = [],
  onToggleGroup,
  onLocationChange,
  onFilterChange,
  onDraftChange,
  onMemoChange,
  onClearDraft,
  onSubmitCount,
  onToggleSelection,
  onToggleVisibleSelection,
  onSubmitBulkCount,
  emptyLabel = "교재가 없습니다",
}: {
  rows: Row[];
  stockCounts: Row[];
  locations: Row[];
  locationId: string;
  auditFilter: InventoryAuditFilter;
  countDrafts: Record<string, string>;
  memoDrafts: Record<string, string>;
  selectedIds?: string[];
  saving: string;
  schemaDisabled: boolean;
  collapsedGroups?: string[];
  onToggleGroup?: (label: string) => void;
  onLocationChange: (value: string) => void;
  onFilterChange: (value: InventoryAuditFilter) => void;
  onDraftChange: (row: InventoryCountRow, value: string) => void;
  onMemoChange: (row: InventoryCountRow, value: string) => void;
  onClearDraft: (row: InventoryCountRow) => void;
  onSubmitCount: (row: InventoryCountRow, countedQuantity: string, memo: string) => void;
  onToggleSelection?: (id: string, checked: boolean) => void;
  onToggleVisibleSelection?: (ids: string[], checked: boolean) => void;
  onSubmitBulkCount?: (rows: InventoryCountRow[]) => void;
  emptyLabel?: string;
}) {
  const [displayLimitsByScope, setDisplayLimitsByScope] = useState<Record<string, number>>({});
  const countRows = useMemo(
    () => buildInventoryCountRows({ rows, stockCounts, locations, locationId }),
    [locationId, locations, rows, stockCounts],
  );
  const filterCounts = useMemo(() => {
    const counts = {
      recommended: 0,
      pending: 0,
      done: 0,
      all: countRows.length,
    } as Record<InventoryAuditFilter, number>;

    for (const row of countRows) {
      counts[row.status] += 1;
    }

    return counts;
  }, [countRows]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visibleRows = useMemo(
    () => auditFilter === "all" ? countRows : countRows.filter((row) => row.status === auditFilter),
    [auditFilter, countRows],
  );
  const visibleAuditFilterOptions = (Object.keys(inventoryAuditFilterLabels) as InventoryAuditFilter[]).filter(
    (filter) => auditFilter === filter || filterCounts[filter] > 0,
  );
  const displayScopeKey = `${auditFilter}:${locationId}:${rows.length}`;
  const displayLimit = displayLimitsByScope[displayScopeKey] || INVENTORY_COUNT_PAGE_SIZE;
  const displayRows = useMemo(() => visibleRows.slice(0, displayLimit), [displayLimit, visibleRows]);
  const displayRowIds = useMemo(() => displayRows.map((row) => row.id).filter(Boolean), [displayRows]);
  const selectedDisplayRows = useMemo(
    () => displayRows.filter((row) => selectedIdSet.has(row.id)),
    [displayRows, selectedIdSet],
  );
  const selectedDraftRows = useMemo(
    () => selectedDisplayRows.filter((row) => text(countDrafts[getInventoryCountDraftKey(row.id, row.locationId)])),
    [countDrafts, selectedDisplayRows],
  );
  const allDisplayRowsSelected = displayRowIds.length > 0 && displayRowIds.every((id) => selectedIdSet.has(id));
  const someDisplayRowsSelected = displayRowIds.some((id) => selectedIdSet.has(id)) && !allDisplayRowsSelected;
  const hasMoreVisibleRows = visibleRows.length > displayRows.length;
  const visibleRowSummary = hasMoreVisibleRows
    ? `${formatQuantity(displayRows.length)}/${formatQuantity(visibleRows.length)}종`
    : `${formatQuantity(visibleRows.length)}종`;
  const groupedRows = useMemo(() => {
    const groupsByLabel = new Map<string, { label: string; rows: InventoryCountRow[] }>();
    for (const row of displayRows) {
      const label = getTextbookGroupLabel(row.source);
      const group = groupsByLabel.get(label);
      if (group) {
        group.rows.push(row);
      } else {
        groupsByLabel.set(label, { label, rows: [row] });
      }
    }
    return [...groupsByLabel.values()].sort((left, right) => compareTextbookGroupLabels(left.label, right.label));
  }, [displayRows]);
  const currentLocation = getLocationName(locations, locationId) || "위치";

  return (
    <section className="grid w-full min-w-0 max-w-[calc(100vw-2rem)] gap-3 overflow-hidden md:max-w-none">
      <div className="flex flex-col gap-2 rounded-lg border bg-background p-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-2 sm:flex sm:items-center">
          <LocationSelect
            locations={locations}
            value={locationId}
            onValueChange={onLocationChange}
            ariaLabel="실사 위치 선택"
          />
          <Badge variant="secondary" className="h-9 justify-center rounded-md px-3 sm:justify-start">
            {currentLocation} {visibleRowSummary}
          </Badge>
          <Badge
            variant="outline"
            className="h-9 justify-center rounded-md px-3 text-xs font-normal text-muted-foreground sm:justify-start"
            title="추천 기준: 한 달에 한 번, 실사 이력 없음, 또는 재고 3권 이하"
          >
            실사 기준
          </Badge>
        </div>
        <div className="grid grid-cols-4 gap-1 sm:flex sm:flex-wrap">
          {visibleAuditFilterOptions.map((filter) => (
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
          {selectedDisplayRows.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 justify-center gap-1 px-2"
              disabled={selectedDraftRows.length === 0}
              aria-label="선택 재고 실사 일괄 반영"
              title="선택 재고 실사 일괄 반영"
              onClick={() => onSubmitBulkCount?.(selectedDisplayRows)}
            >
              선택 반영 {formatQuantity(selectedDraftRows.length)}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 md:hidden">
        {displayRows.map((row) => {
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
              onClear={() => onClearDraft(row)}
              onSubmit={(value, memo) => onSubmitCount(row, value, memo)}
            />
          );
        })}
        {visibleRows.length === 0 ? (
          <div className="rounded-lg border py-8 text-center text-sm text-muted-foreground">{emptyLabel}</div>
        ) : null}
      </div>

      <div
        className="hidden overflow-x-auto rounded-lg border [contain-intrinsic-size:720px] [content-visibility:auto] md:block"
        aria-label="재고 실사 목록"
      >
        <Table className="min-w-[1260px] table-fixed">
          <caption className="sr-only">재고 실사 입력 목록</caption>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allDisplayRowsSelected || (someDisplayRowsSelected && "indeterminate")}
                  onCheckedChange={(value) => onToggleVisibleSelection?.(displayRowIds, value === true)}
                  title="표시된 재고 행 전체 선택"
                  aria-label="표시된 재고 행 전체 선택"
                />
              </TableHead>
              <TableHead className="w-[32%]">교재</TableHead>
              <TableHead className="w-24">위치</TableHead>
              <TableHead className="w-20 text-right">현재</TableHead>
              <TableHead className="w-36">실사</TableHead>
              <TableHead className="w-20 text-right">차이</TableHead>
              <TableHead className="w-24">상태</TableHead>
              <TableHead className="w-40">최종 실사</TableHead>
              <TableHead className="w-56">메모</TableHead>
              <TableHead className={cn("w-24 text-right", stickyActionHeadClassName)}>작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupedRows.map((group) => {
              const isCollapsed = collapsedGroups.includes(group.label);
              const GroupIcon = isCollapsed ? ChevronRight : ChevronDown;
              const groupRecommendedCount = group.rows.filter((row) => row.isRecommended).length;
              return (
                <Fragment key={group.label}>
                  <TableRow>
                    <TableCell colSpan={10} className="bg-muted/40 p-0 text-xs font-semibold text-muted-foreground">
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
                            <Badge
                              variant="outline"
                              className="rounded-md border-blue-200 bg-blue-50 text-blue-700 tabular-nums"
                              title="이번 달 실사를 먼저 진행할 교재"
                            >
                              할 일 {formatQuantity(groupRecommendedCount)}
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
                    const hasDraft = text(draftValue);
                    const hasDraftContent = Boolean(hasDraft || text(memoValue));
                    const difference = text(draftValue) ? numberValue(draftValue) - row.currentQuantity : 0;
                    const isSaving = saving === `count-inline-${draftKey}`;
                    return (
                      <TableRow key={draftKey} className={cn(hasDraft && "bg-blue-50/40")}>
                        <TableCell>
                          <Checkbox
                            checked={selectedIdSet.has(row.id)}
                            onCheckedChange={(value) => onToggleSelection?.(row.id, value === true)}
                            title={`${row.title} ${row.locationName} 재고 선택`}
                            aria-label={`${row.title} ${row.locationName} 재고 선택`}
                          />
                        </TableCell>
                        <TableCell className="min-w-0">
                          <div className="truncate font-medium">{row.title}</div>
                          <div className="truncate text-xs text-muted-foreground">{row.publisher}</div>
                        </TableCell>
                        <TableCell>{row.locationName}</TableCell>
                        <TableCell className="text-right font-mono">{formatQuantity(row.currentQuantity)}</TableCell>
                        <TableCell className="space-y-1">
                          <Input
                            value={draftValue}
                            onChange={(event) => onDraftChange(row, event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" && hasDraft) {
                                event.preventDefault();
                                onSubmitCount(row, draftValue, memoValue);
                              }
                            }}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            autoComplete="off"
                            enterKeyHint="done"
                            aria-label={`${row.title} ${row.locationName} 실사 수량`}
                            placeholder={`${formatQuantity(row.currentQuantity)}`}
                            className="h-9 text-right font-mono"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 w-full px-2 text-xs"
                            title={hasDraftContent ? "실사 입력 초기화" : "현재 수량 입력"}
                            aria-label={hasDraftContent ? `${row.title} ${row.locationName} 실사 입력 초기화` : `${row.title} ${row.locationName} 현재 수량 입력`}
                            onClick={() => {
                              if (hasDraftContent) {
                                onClearDraft(row);
                                return;
                              }
                              onDraftChange(row, getInventoryCurrentQuantityDraft(row));
                            }}
                          >
                            {hasDraftContent ? "초기화" : "현재"}
                          </Button>
                        </TableCell>
                        <TableCell className={cn("text-right font-mono", difference < 0 && "text-red-600", difference > 0 && "text-emerald-700")}>
                          {text(draftValue) ? `${difference > 0 ? "+" : ""}${formatQuantity(difference)}` : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn("rounded-md", getInventoryCountStatusClassName(row))}
                            title={getInventoryCountReasonLabel(row)}
                          >
                            {inventoryAuditFilterLabels[row.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <div>{row.latestCountAt ? formatCompactDateTime(row.latestCountAt) : "실사 없음"}</div>
                          <div className="truncate" title={getInventoryCountReasonLabel(row)}>{getInventoryCountReasonLabel(row)}</div>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={memoValue}
                            onChange={(event) => onMemoChange(row, event.target.value)}
                            onBlur={(event) => onMemoChange(row, normalizeStoredTextInput(event.target.value))}
                            aria-label={`${row.title} ${row.locationName} 실사 메모`}
                            placeholder="메모"
                            className="h-9"
                          />
                        </TableCell>
                        <TableCell className={cn("text-right", stickyActionCellClassName)}>
                          <Button
                            type="button"
                            size="sm"
                            variant={hasDraft ? "default" : "outline"}
                            title={getInventoryCountSubmitLabel({ row, draftValue, isSaving, schemaDisabled })}
                            aria-label={getInventoryCountSubmitLabel({ row, draftValue, isSaving, schemaDisabled })}
                            disabled={schemaDisabled || isSaving || !text(draftValue)}
                            aria-busy={isSaving}
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
                <TableCell colSpan={10} className="h-28 text-center text-muted-foreground">
                  {emptyLabel}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      {hasMoreVisibleRows ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            className="min-w-48"
            onClick={() => setDisplayLimitsByScope((current) => ({
              ...current,
              [displayScopeKey]: (current[displayScopeKey] || INVENTORY_COUNT_PAGE_SIZE) + INVENTORY_COUNT_PAGE_SIZE,
            }))}
          >
            더 보기 · {formatQuantity(displayRows.length)}/{formatQuantity(visibleRows.length)}종
          </Button>
        </div>
      ) : null}
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
  onClear,
  onSubmit,
}: {
  row: InventoryCountRow;
  value: string;
  memoValue: string;
  saving: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onMemoChange: (value: string) => void;
  onClear: () => void;
  onSubmit: (value: string, memo: string) => void;
}) {
  const difference = text(value) ? numberValue(value) - row.currentQuantity : 0;
  const hasDraftContent = Boolean(text(value) || text(memoValue));
  const submitLabel = getInventoryCountSubmitLabel({
    row,
    draftValue: value,
    isSaving: saving,
    schemaDisabled: disabled,
  });

  return (
    <form
      className={cn("min-w-0 max-w-full overflow-hidden rounded-lg border bg-background p-3 shadow-sm active:scale-[0.99]", text(value) && "border-blue-200 bg-blue-50/30")}
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
        <Badge
          variant="outline"
          className={cn("shrink-0 rounded-md", getInventoryCountStatusClassName(row))}
          title={getInventoryCountReasonLabel(row)}
        >
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
        onBlur={(event) => onMemoChange(normalizeStoredTextInput(event.target.value))}
        aria-label={`${row.title} ${row.locationName} 실사 메모`}
        placeholder="메모"
        className="mt-3 h-11"
      />
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_88px] gap-2">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && text(value)) {
              event.preventDefault();
              onSubmit(value, memoValue);
            }
          }}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          enterKeyHint="done"
          aria-label={`${row.title} ${row.locationName} 실사 수량`}
          placeholder={`${formatQuantity(row.currentQuantity)}`}
          className="h-12 text-right font-mono text-base"
        />
        <Button type="submit" className="h-12" title={submitLabel} aria-label={submitLabel} disabled={disabled || saving || !text(value)}>
          반영
        </Button>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2 h-9 w-full"
        title={hasDraftContent ? "실사 입력 초기화" : "현재 수량 입력"}
        aria-label={hasDraftContent ? `${row.title} ${row.locationName} 실사 입력 초기화` : `${row.title} ${row.locationName} 현재 수량 입력`}
        onClick={() => {
          if (hasDraftContent) {
            onClear();
            return;
          }
          onChange(getInventoryCurrentQuantityDraft(row));
        }}
      >
        {hasDraftContent ? "실사 입력 초기화" : "현재 수량 입력"}
      </Button>
      <div className="mt-2 text-xs text-muted-foreground">
        {row.latestCountAt
          ? `최종 ${formatCompactDateTime(row.latestCountAt)} · ${getInventoryCountReasonLabel(row)}`
          : getInventoryCountReasonLabel(row)}
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
  emptyActionLabel,
  onEmptyAction,
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
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
}) {
  const amountHeader = amountMode === "salePrice" ? "판매가" : "재고금액";
  const hasSelection = Boolean(onBulkSelectionChange);
  const locationColumns = useMemo(
    () => locations.map((location) => ({
      id: getRecordId(location),
      label: text(location.name || location.code),
    })),
    [locations],
  );
  const columnSpan = locationColumns.length + 7 + (onSelectTextbook ? 1 : 0) + (hasSelection ? 1 : 0);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const sortedGroupedRows = useMemo(() => {
    const groupsByLabel = new Map<string, Row[]>();
    for (const row of rows) {
      const label = getTextbookGroupLabel(row);
      const groupRows = groupsByLabel.get(label);
      if (groupRows) {
        groupRows.push(row);
      } else {
        groupsByLabel.set(label, [row]);
      }
    }

    return [...groupsByLabel.entries()]
      .map(([label, groupRows]) => ({
        label,
        rows: [...groupRows].sort((left, right) => {
          const leftScore = getTextbookQualityScore(left, duplicateTitleKeys);
          const rightScore = getTextbookQualityScore(right, duplicateTitleKeys);
          if (leftScore !== rightScore) return rightScore - leftScore;
          return getTextbookTitle(left).localeCompare(getTextbookTitle(right), "ko", { numeric: true });
        }),
      }))
      .sort((left, right) => compareTextbookGroupLabels(left.label, right.label));
  }, [duplicateTitleKeys, rows]);
  const tableTotals = useMemo(() => {
    const locationQuantities = Object.fromEntries(locationColumns.map((location) => [location.id, 0])) as Record<string, number>;
    let totalQuantity = 0;
    let amountValue = 0;

    for (const row of rows) {
      totalQuantity += numberValue(row.totalQuantity);
      amountValue += numberValue(amountMode === "salePrice" ? getTextbookSalePrice(row) : row.stockValue);
      const rowLocationQuantities = (row.locationQuantities || {}) as Record<string, unknown>;
      for (const location of locationColumns) {
        locationQuantities[location.id] += numberValue(rowLocationQuantities[location.id]);
      }
    }

    return { totalQuantity, amountValue, locationQuantities };
  }, [amountMode, locationColumns, rows]);

  return (
    <div className="space-y-2" aria-label="교재 목록">
      <div data-testid="textbook-master-mobile-list" className="grid gap-2 md:hidden">
        {sortedGroupedRows.map((group) => {
          const isCollapsed = collapsedGroups.includes(group.label);
          const GroupIcon = isCollapsed ? ChevronRight : ChevronDown;
          const groupTotalQuantity = group.rows.reduce((sum, row) => sum + numberValue(row.totalQuantity), 0);

          return (
            <section key={`mobile-${group.label}`} className="overflow-hidden rounded-md border bg-background">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto w-full justify-start rounded-none border-b px-3 py-2 text-left"
                aria-expanded={!isCollapsed}
                onClick={() => onToggleGroup?.(group.label)}
              >
                <GroupIcon className="mr-2 size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{group.label}</span>
                <span className="ml-2 shrink-0 text-xs font-medium text-muted-foreground">
                  {formatQuantity(group.rows.length)}종 · 재고 {formatQuantity(groupTotalQuantity)}
                </span>
              </Button>
              {isCollapsed ? null : (
                <div className="grid min-w-0 gap-2 p-2">
                  {group.rows.map((row) => {
                    const rowId = getRecordId(row);
                    const rowA11yLabel = getTextbookIdentityLabel(row);
                    const totalQuantity = numberValue(row.totalQuantity);
                    const teacherQuantity = numberValue(row.teacherQuantity);
                    const publisherLabel = getKnownPublisherLabel(row);
                    const locationQuantities = (row.locationQuantities || {}) as Record<string, unknown>;
                    const amountValue = amountMode === "salePrice" ? getTextbookSalePrice(row) : row.stockValue;
                    const gradeLabel = getTextbookGradeLabel(getTextbookGradeLevel(row)) || getTextbookSchoolLevelLabel(getTextbookSchoolLevel(row)) || "-";
                    const subSubjectLabel = getTextbookSubSubject(row) || "-";
                    const categorySummary = compactUniqueLabels([getSubjectLabel(row.subject), gradeLabel, subSubjectLabel]).join(" · ") || "-";
                    const qualityIssues = getTextbookQualityIssues(row, duplicateTitleKeys);
                    const qualityIssueLabels = getTextbookQualityIssueLabels(qualityIssues);
                    const locationSummary = locationColumns
                      .map((location) => ({
                        label: location.label,
                        quantity: numberValue(locationQuantities[location.id]),
                      }))
                      .filter((location) => location.quantity !== 0)
                      .slice(0, 3);

                    return (
                      <article
                        key={rowId}
                        data-testid={`textbook-master-mobile-card-${rowId}`}
                        className={cn(
                          "min-w-0 rounded-md border bg-background p-3 shadow-xs",
                          qualityIssues.inactive && "bg-muted/20 text-muted-foreground",
                        )}
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          {hasSelection ? (
                            <Checkbox
                              checked={selectedIdSet.has(rowId)}
                              onCheckedChange={(value) => onBulkSelectionChange?.(rowId, !!value)}
                              title={`${rowA11yLabel} 선택`}
                              aria-label={`${rowA11yLabel} 선택`}
                              className="mt-1 shrink-0"
                            />
                          ) : null}
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex min-w-0 items-start justify-between gap-2">
                              <div className="min-w-0">
                                {onSelectTextbook ? (
                                  <button
                                    type="button"
                                    aria-label={`${rowA11yLabel} 열기`}
                                    title={rowA11yLabel}
                                    className="block max-w-full truncate text-left text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                    onClick={() => onSelectTextbook(row)}
                                  >
                                    {getTextbookTitle(row)}
                                  </button>
                                ) : (
                                  <p className="truncate text-sm font-semibold">{getTextbookTitle(row)}</p>
                                )}
                                {publisherLabel ? <p className="truncate text-xs text-muted-foreground">{publisherLabel}</p> : null}
                              </div>
                              {onSelectTextbook ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 shrink-0 rounded-md"
                                  aria-label={`${rowA11yLabel} 편집`}
                                  title={`${getTextbookTitle(row)} 편집`}
                                  onClick={() => onSelectTextbook(row)}
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                              ) : null}
                            </div>

                            <div className="flex flex-wrap gap-1.5">
                              <Badge variant="secondary" className="rounded px-1.5 text-[11px]">{categorySummary}</Badge>
                              {qualityIssueLabels.length > 0 ? (
                                <Badge variant="outline" className="rounded px-1.5 text-[11px] text-amber-700">
                                  정리 {formatQuantity(qualityIssueLabels.length)}
                                </Badge>
                              ) : null}
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="rounded-md bg-muted/40 px-2 py-1.5">
                                <p className="text-muted-foreground">합계</p>
                                <p className={cn("font-semibold tabular-nums", inventoryQuantityTone(totalQuantity))}>
                                  {formatQuantity(totalQuantity)}
                                </p>
                                {teacherQuantity > 0 ? (
                                  <p className="text-[11px] text-muted-foreground">교사용 {formatQuantity(teacherQuantity)}</p>
                                ) : null}
                              </div>
                              <div className="rounded-md bg-muted/40 px-2 py-1.5 text-right">
                                <p className="text-muted-foreground">{amountHeader}</p>
                                <p className="font-semibold tabular-nums">{formatCurrency(amountValue)}</p>
                              </div>
                            </div>

                            {locationSummary.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                                {locationSummary.map((location) => (
                                  <span key={`${rowId}-${location.label}`} className="rounded border px-1.5 py-0.5 tabular-nums">
                                    {location.label} {formatQuantity(location.quantity)}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
        {rows.length === 0 ? (
          <div className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            <span>{emptyLabel}</span>
            {emptyActionLabel && onEmptyAction ? (
              <Button type="button" variant="outline" size="sm" className="h-8 rounded-md" onClick={onEmptyAction}>
                {emptyActionLabel}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border [contain-intrinsic-size:720px] [content-visibility:auto] md:block">
      <Table className="min-w-[1080px] table-fixed">
        <caption className="sr-only">교재 마스터 목록</caption>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            {hasSelection ? (
              <TableHead className="w-10">
                <Checkbox
                  checked={allVisibleSelected || (someVisibleSelected && "indeterminate")}
                  onCheckedChange={(value) => onToggleAllVisible?.(!!value)}
                  title="현재 교재 전체 선택"
                  aria-label="현재 교재 전체 선택"
                />
              </TableHead>
            ) : null}
            <TableHead className="w-[30%] min-w-64">교재</TableHead>
            <TableHead className="w-24">과목</TableHead>
            <TableHead className="w-32">세부과목</TableHead>
            <TableHead className="w-28">학교 구분</TableHead>
            <TableHead className="w-24">학년</TableHead>
            {locationColumns.map((location) => (
              <TableHead key={location.id} className="w-20 text-right">{location.label}</TableHead>
            ))}
            <TableHead className="w-20 text-right">합계</TableHead>
            <TableHead className="w-24 text-right">{amountHeader}</TableHead>
            {onSelectTextbook ? <TableHead className={cn("w-12 text-right", stickyActionHeadClassName)}>관리</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedGroupedRows.map((group) => (
            <Fragment key={group.label}>
              {(() => {
                const isCollapsed = collapsedGroups.includes(group.label);
                const GroupIcon = isCollapsed ? ChevronRight : ChevronDown;
                const groupTotalQuantity = group.rows.reduce((sum, row) => sum + numberValue(row.totalQuantity), 0);
                const groupQualityIssueCount = group.rows.filter((row) => hasTextbookQualityIssue(row, duplicateTitleKeys)).length;
                const groupCountLabel = `${formatQuantity(group.rows.length)}종`;
                const groupDetailText = [
                  `${formatQuantity(group.rows.length)}종`,
                  groupQualityIssueCount > 0 ? `정리 ${formatQuantity(groupQualityIssueCount)}건` : "",
                  `재고 ${formatQuantity(groupTotalQuantity)}권`,
                ].filter(Boolean).join(" · ");

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
                          aria-label={`${group.label} 그룹 ${isCollapsed ? "펼치기" : "접기"} · ${groupDetailText}`}
                          title={groupDetailText}
                          onClick={() => onToggleGroup?.(group.label)}
                        >
                          <GroupIcon className="mr-2 size-3.5" />
                          <span>{group.label}</span>
                          <span className="ml-auto flex min-w-0 items-center gap-1.5">
                            <span className="tabular-nums text-muted-foreground">{groupCountLabel}</span>
                            {groupQualityIssueCount > 0 ? (
                              <Badge variant="outline" className="h-5 rounded px-1.5 text-[11px] text-amber-700 tabular-nums" title="분류, 가격, ISBN 등 정리가 필요한 교재 수">
                                정리 {formatQuantity(groupQualityIssueCount)}
                              </Badge>
                            ) : null}
                          </span>
                        </Button>
                      </TableCell>
                    </TableRow>
                    {isCollapsed ? null : group.rows.map((row) => {
                const rowId = getRecordId(row);
                const rowA11yLabel = getTextbookIdentityLabel(row);
                const totalQuantity = numberValue(row.totalQuantity);
                const teacherQuantity = numberValue(row.teacherQuantity);
                const publisherLabel = getKnownPublisherLabel(row);
                const locationQuantities = (row.locationQuantities || {}) as Record<string, unknown>;
                const amountValue = amountMode === "salePrice" ? getTextbookSalePrice(row) : row.stockValue;
                const subjectLabel = getSubjectLabel(row.subject) || "-";
                const gradeLabel = getTextbookGradeLabel(getTextbookGradeLevel(row)) || "-";
                const schoolLevelLabel = getTextbookSchoolLevelLabel(getTextbookSchoolLevel(row)) || "-";
                const subSubjectLabel = getTextbookSubSubject(row) || "-";
                const qualityIssues = getTextbookQualityIssues(row, duplicateTitleKeys);
                const qualityIssueLabels = getTextbookQualityIssueLabels(qualityIssues);
                const qualityIssueSummary = getQualityIssueSummary(qualityIssueLabels);
                return (
                  <TableRow key={rowId} className={cn(qualityIssues.inactive && "bg-muted/20 text-muted-foreground")}>
                    {hasSelection ? (
                      <TableCell className="w-10">
                        <Checkbox
                          checked={selectedIdSet.has(rowId)}
                          onCheckedChange={(value) => onBulkSelectionChange?.(rowId, !!value)}
                          title={`${rowA11yLabel} 선택`}
                          aria-label={`${rowA11yLabel} 선택`}
                        />
                      </TableCell>
                    ) : null}
                    <TableCell className="min-w-0">
                      {onSelectTextbook ? (
                        <button
                          type="button"
                          aria-label={`${rowA11yLabel} 열기`}
                          title={rowA11yLabel}
                          className="block max-w-full truncate text-left font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          onClick={() => onSelectTextbook(row)}
                        >
                          {getTextbookTitle(row)}
                        </button>
                      ) : (
                        <div className="font-medium">{getTextbookTitle(row)}</div>
                      )}
                      {publisherLabel ? (
                        <div className="text-xs text-muted-foreground">{publisherLabel}</div>
                      ) : null}
                      {qualityIssueLabels.length > 0 ? (
                        <Badge
                          variant="outline"
                          className="mt-1 h-5 rounded px-1.5 text-[11px] text-amber-700"
                          title={qualityIssueSummary}
                          aria-label={`정리 필요: ${qualityIssueSummary}`}
                        >
                          정리 {formatQuantity(qualityIssueLabels.length)}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-[96px] truncate" title={subjectLabel}>{subjectLabel}</TableCell>
                    <TableCell className="max-w-[128px] truncate" title={subSubjectLabel}>{subSubjectLabel}</TableCell>
                    <TableCell className="max-w-[112px] truncate" title={schoolLevelLabel}>{schoolLevelLabel}</TableCell>
                    <TableCell className="max-w-[96px] truncate" title={gradeLabel}>{gradeLabel}</TableCell>
                    {locationColumns.map((location) => (
                      <TableCell key={location.id} className="text-right tabular-nums">
                        {formatQuantity(locationQuantities[location.id])}
                      </TableCell>
                    ))}
                    <TableCell className={cn("text-right font-medium tabular-nums", inventoryQuantityTone(totalQuantity))}>
                      {formatQuantity(totalQuantity)}
                      {teacherQuantity > 0 ? (
                        <div className="text-[11px] font-normal text-muted-foreground">교사용 {formatQuantity(teacherQuantity)}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(amountValue)}</TableCell>
                    {onSelectTextbook ? (
                      <TableCell className={cn("text-right", stickyActionCellClassName)}>
                        <Button type="button" variant="ghost" size="icon" className="size-8 rounded-md" aria-label={`${rowA11yLabel} 편집`} title={`${getTextbookTitle(row)} 편집`} onClick={() => onSelectTextbook(row)}>
                          <Pencil className="size-3.5" />
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
	              {locationColumns.map((location) => (
                <TableCell key={location.id} className="text-right tabular-nums">
                  {formatQuantity(tableTotals.locationQuantities[location.id])}
                </TableCell>
              ))}
              <TableCell className="text-right tabular-nums">{formatQuantity(tableTotals.totalQuantity)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCurrency(tableTotals.amountValue)}</TableCell>
              {onSelectTextbook ? <TableCell /> : null}
            </TableRow>
          ) : null}
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnSpan} className="h-28 text-center text-muted-foreground">
                <div className="flex flex-col items-center justify-center gap-2">
                  <span>{emptyLabel}</span>
                  {emptyActionLabel && onEmptyAction ? (
                    <Button type="button" variant="outline" size="sm" className="h-8 rounded-md" onClick={onEmptyAction}>
                      {emptyActionLabel}
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
      </div>
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
  canDeleteHistory,
  saving,
  onDeleteHistory,
}: {
  stockMoves: Row[];
  stockCounts: Row[];
  textbooks: Row[];
  locations: Row[];
  currentUserId: string;
  currentUserLabel: string;
  canDeleteHistory: boolean;
  saving: string;
  onDeleteHistory: (row: InventoryHistoryRow) => void;
}) {
  const textbookLookup = useMemo(() => buildTextbookLookupMap(textbooks), [textbooks]);
  const locationNameLookup = useMemo(() => buildLocationNameLookup(locations), [locations]);
  const rows = useMemo(() => {
    const historyRows: InventoryHistoryRow[] = [];
    for (const move of stockMoves) {
      const quantity = numberValue(move.quantity);
      const textbook = getTextbookFromLookup(textbookLookup, move.textbook_id || move.textbookId);
      const type = text(move.move_type || move.moveType);
      historyRows.push({
        id: `move-${getRecordId(move)}`,
        kind: "move" as const,
        sourceId: getRecordId(move),
        linkedMoveId: "",
        at: text(move.moved_at || move.movedAt || move.created_at || move.createdAt),
        textbookTitle: getTextbookTitle(textbook || {}) || "-",
        locationName: getLocationNameFromLookup(locationNameLookup, move.location_id || move.locationId) || "-",
        change: `${quantity > 0 ? "+" : ""}${formatQuantity(quantity)}권`,
        action: stockMoveTypeLabels[type] || type || "재고 변경",
        actor: getInventoryAuditActor(move, currentUserId, currentUserLabel),
        memo: text(move.memo),
      });
    }
    for (const count of stockCounts) {
      const expected = numberValue(count.expected_quantity || count.expectedQuantity);
      const counted = numberValue(count.counted_quantity || count.countedQuantity);
      const difference = counted - expected;
      const textbook = getTextbookFromLookup(textbookLookup, count.textbook_id || count.textbookId);
      historyRows.push({
        id: `count-${getRecordId(count)}`,
        kind: "count" as const,
        sourceId: getRecordId(count),
        linkedMoveId: text(count.adjustment_move_id || count.adjustmentMoveId),
        at: text(count.counted_at || count.countedAt || count.created_at || count.createdAt),
        textbookTitle: getTextbookTitle(textbook || {}) || "-",
        locationName: getLocationNameFromLookup(locationNameLookup, count.location_id || count.locationId) || "-",
        change: `${difference > 0 ? "+" : ""}${formatQuantity(difference)}권`,
        action: `실사 ${formatQuantity(expected)}→${formatQuantity(counted)}`,
        actor: getInventoryAuditActor(count, currentUserId, currentUserLabel),
        memo: text(count.memo),
      });
    }

    return historyRows
      .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
      .slice(0, 30);
  }, [currentUserId, currentUserLabel, locationNameLookup, stockCounts, stockMoves, textbookLookup]);

  return (
    <section className="overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h3 className="text-sm font-semibold">재고 이력</h3>
        <Badge variant="secondary" className="rounded-md">최근 {formatQuantity(rows.length)}건</Badge>
      </div>
      <div className="grid gap-2 p-2 md:hidden">
        {rows.map((row) => (
          <div key={row.id} className="grid min-w-0 gap-2 rounded-md border bg-background p-3">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{row.textbookTitle}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{formatCompactDateTime(row.at)} · {row.locationName}</div>
              </div>
              <Badge variant="outline" className="shrink-0 rounded-md font-mono">{row.change}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div className="min-w-0 truncate">{row.action}</div>
              <div className="min-w-0 truncate text-right">{row.actor}</div>
            </div>
            {row.memo ? <div className="truncate text-xs text-muted-foreground">{row.memo}</div> : null}
            {canDeleteHistory ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-full text-muted-foreground hover:text-destructive"
                disabled={saving === `inventory-history-delete-${row.id}`}
                aria-label={`${row.textbookTitle} 재고 이력 삭제`}
                title="재고 이력 삭제"
                onClick={() => onDeleteHistory(row)}
              >
                <Trash2 className="mr-2 size-3.5" />
                이력 삭제
              </Button>
            ) : null}
          </div>
        ))}
        {rows.length === 0 ? (
          <div className="rounded-md border py-6 text-center text-sm text-muted-foreground">재고 이력이 없습니다</div>
        ) : null}
      </div>
      <div className="hidden overflow-x-auto md:block">
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
              {canDeleteHistory ? <TableHead className="w-[72px] text-right">삭제</TableHead> : null}
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
                {canDeleteHistory ? (
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      disabled={saving === `inventory-history-delete-${row.id}`}
                      aria-label={`${row.textbookTitle} 재고 이력 삭제`}
                      title="재고 이력 삭제"
                      onClick={() => onDeleteHistory(row)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canDeleteHistory ? 8 : 7} className="h-20 text-center text-muted-foreground">
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

type ClosingStoredMetrics = {
  purchaseQuantity: number;
  saleQuantity: number;
  endingQuantity: number;
  marginAmount: number;
  status: string;
  memo: string;
};

function getClosingStoredMetrics(row: Row | undefined): ClosingStoredMetrics {
  return {
    purchaseQuantity: numberValue(row?.purchase_quantity || row?.purchaseQuantity),
    saleQuantity: numberValue(row?.sale_quantity || row?.saleQuantity),
    endingQuantity: numberValue(row?.ending_quantity || row?.endingQuantity),
    marginAmount: numberValue(
      row?.settlement_difference
        || row?.settlementDifference
        || row?.textbook_margin_amount
        || row?.textbookMarginAmount,
    ),
    status: text(row?.status) || "대기",
    memo: text(row?.memo),
  };
}

function hasClosingMetricMismatch(storedValue: number, detailValue: number) {
  return Math.round(storedValue) !== Math.round(detailValue);
}

function getClosingDetailSearchHaystack(item: {
  typeLabel: string;
  textbookTitle: string;
  locationName: string;
  quantity: number;
  amount: number;
  marginAmount: number;
}) {
  return [
    item.typeLabel,
    item.textbookTitle,
    item.locationName,
    String(item.quantity),
    String(item.amount),
    String(item.marginAmount),
  ].join(" ").toLowerCase();
}

function buildClosingDetailClipboardText({
  title,
  storedClosingMetrics,
  detailClosing,
  filteredDetailRows,
  closingMetricMismatchCount,
}: {
  title: string;
  storedClosingMetrics: ClosingStoredMetrics;
  detailClosing: ReturnType<typeof buildTextbookMonthlyClosing>;
  filteredDetailRows: Array<{
    at: string;
    typeLabel: string;
    textbookTitle: string;
    locationName: string;
    quantity: number;
    amount: number;
    marginAmount: number;
  }>;
  closingMetricMismatchCount: number;
}) {
  const lines = [
    `[교재 정산 상세] ${title}`,
    `저장 입고 ${formatQuantity(storedClosingMetrics.purchaseQuantity)}권 / 저장 출고 ${formatQuantity(storedClosingMetrics.saleQuantity)}권 / 저장 기말 ${formatQuantity(storedClosingMetrics.endingQuantity)}권 / 저장 마진 ${formatCurrency(storedClosingMetrics.marginAmount)}`,
    `현재 상세 입고 ${formatQuantity(detailClosing.purchaseQuantity)}권 / 현재 상세 출고 ${formatQuantity(detailClosing.saleQuantity)}권 / 현재 상세 기말 ${formatQuantity(detailClosing.endingQuantity)}권 / 현재 상세 마진 ${formatCurrency(detailClosing.textbookMarginAmount)}`,
    `상태 ${storedClosingMetrics.status}${closingMetricMismatchCount > 0 ? ` / 차이 ${formatQuantity(closingMetricMismatchCount)}개` : ""}`,
  ];

  if (storedClosingMetrics.memo) {
    lines.push(`메모 ${storedClosingMetrics.memo}`);
  }

  lines.push(
    "",
    "일시\t구분\t교재\t위치\t수량\t금액\t마진",
    ...filteredDetailRows.map((item) => [
      formatCompactDateTime(item.at),
      item.typeLabel,
      item.textbookTitle,
      item.locationName,
      `${item.quantity > 0 ? "+" : ""}${formatQuantity(item.quantity)}`,
      formatCurrency(item.amount),
      item.marginAmount > 0 ? formatCurrency(item.marginAmount) : "-",
    ].join("\t")),
  );

  return lines.join("\n");
}

function ClosingDetailDialog({
  open,
  row,
  stockMoves,
  textbooks,
  publishers,
  suppliers,
  publisherSupplierLinks,
  locations,
  onOpenChange,
}: {
  open: boolean;
  row: Row | undefined;
  stockMoves: Row[];
  textbooks: Row[];
  publishers: Row[];
  suppliers: Row[];
  publisherSupplierLinks: Row[];
  locations: Row[];
  onOpenChange: (open: boolean) => void;
}) {
  const [detailQuery, setDetailQuery] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [isCopyingDetail, setIsCopyingDetail] = useState(false);
  const closingMonth = text(row?.closing_month || row?.closingMonth);
  const subject = text(row?.subject) || "all";
  const storedClosingMetrics = useMemo(() => getClosingStoredMetrics(row), [row]);
  const textbookLookup = useMemo(() => buildTextbookLookupMap(textbooks), [textbooks]);
  const locationNameLookup = useMemo(() => buildLocationNameLookup(locations), [locations]);
  useEffect(() => {
    if (!open) {
      setDetailQuery("");
      setCopyStatus("");
      return;
    }
    setCopyStatus("");
  }, [open, row]);
  const detailMoves = useMemo(() => {
    if (!row) return [] as Row[];
    return filterStockMovesForClosing({
      closingMonth,
      subject,
      textbooks,
      publishers,
      suppliers,
      publisherSupplierLinks,
      stockMoves,
    });
  }, [closingMonth, publisherSupplierLinks, publishers, row, stockMoves, subject, suppliers, textbooks]);
  const detailClosing = useMemo(
    () => buildTextbookMonthlyClosing({
      openingQuantity: numberValue(row?.opening_quantity || row?.openingQuantity),
      openingAmount: numberValue(row?.opening_amount || row?.openingAmount),
      stockMoves: detailMoves,
    }),
    [detailMoves, row],
  );
  const detailRows = useMemo(() => detailMoves
    .map((move) => {
      const type = text(move.move_type || move.moveType);
      const quantity = numberValue(move.quantity);
      const unitSalePrice = Math.abs(numberValue(move.unit_amount || move.unitAmount)) || getTextbookSalePrice(move);
      const saleQuantity = type === "sale_issue" ? Math.abs(quantity) : 0;
      const unitPurchaseCost = saleQuantity > 0
        ? getTextbookPurchaseUnitCost({ ...move, sale_price: unitSalePrice, price: unitSalePrice })
        : 0;
      const marginAmount = saleQuantity > 0
        ? Math.max(0, (unitSalePrice - unitPurchaseCost) * saleQuantity)
        : 0;
      const textbook = (move.textbook || getTextbookFromLookup(textbookLookup, move.textbook_id || move.textbookId)) as Row | undefined;
      return {
        id: getRecordId(move),
        at: text(move.moved_at || move.movedAt || move.created_at || move.createdAt),
        typeLabel: stockMoveTypeLabels[type] || type || "재고 변경",
        textbookTitle: getTextbookTitle(textbook || {}) || "-",
        locationName: getLocationNameFromLookup(locationNameLookup, move.location_id || move.locationId) || "-",
        quantity,
        amount: numberValue(move.amount || move.total_amount || move.totalAmount),
        marginAmount,
      };
    })
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime()), [detailMoves, locationNameLookup, textbookLookup]);
  const title = `${closingMonth || "정산"} · ${subject === "all" ? "전체" : getSubjectLabel(subject)}`;
  const closingMetricMismatches = useMemo(() => ({
    purchase: hasClosingMetricMismatch(storedClosingMetrics.purchaseQuantity, detailClosing.purchaseQuantity),
    sale: hasClosingMetricMismatch(storedClosingMetrics.saleQuantity, detailClosing.saleQuantity),
    ending: hasClosingMetricMismatch(storedClosingMetrics.endingQuantity, detailClosing.endingQuantity),
    margin: hasClosingMetricMismatch(storedClosingMetrics.marginAmount, detailClosing.textbookMarginAmount),
  }), [detailClosing, storedClosingMetrics]);
  const closingMetricMismatchCount = Object.values(closingMetricMismatches).filter(Boolean).length;
  const closingDetailStatus = storedClosingMetrics.status;
  const closingDetailMemo = storedClosingMetrics.memo;
  const normalizedDetailQuery = normalizeStoredTextInput(detailQuery).toLowerCase();
  const filteredDetailRows = useMemo(() => {
    if (!normalizedDetailQuery) return detailRows;
    return detailRows.filter((item) => getClosingDetailSearchHaystack(item).includes(normalizedDetailQuery));
  }, [detailRows, normalizedDetailQuery]);
  const closingDetailCopyText = useMemo(() => buildClosingDetailClipboardText({
    title,
    storedClosingMetrics,
    detailClosing,
    filteredDetailRows,
    closingMetricMismatchCount,
  }), [closingMetricMismatchCount, detailClosing, filteredDetailRows, storedClosingMetrics, title]);
  const copyClosingDetail = useCallback(async () => {
    setIsCopyingDetail(true);
    try {
      await writeClipboardText(closingDetailCopyText);
      setCopyStatus("복사됨");
    } catch {
      setCopyStatus("복사 실패");
    } finally {
      setIsCopyingDetail(false);
    }
  }, [closingDetailCopyText]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] overflow-x-hidden overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">저장된 월마감값과 현재 재고 이동 재계산값을 함께 확인합니다.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="h-7 rounded-md px-2">저장값</Badge>
          <Badge variant="outline" className="h-7 rounded-md px-2">상태 {closingDetailStatus}</Badge>
          <Badge variant={closingMetricMismatchCount > 0 ? "destructive" : "outline"} className="h-7 rounded-md px-2 tabular-nums">
            차이 {formatQuantity(closingMetricMismatchCount)}개
          </Badge>
          {closingDetailMemo ? <span className="min-w-0 truncate">메모 {closingDetailMemo}</span> : null}
        </div>
        {closingMetricMismatchCount > 0 ? (
          <Alert role="alert" className="border-amber-200 bg-amber-50 text-amber-900">
            <AlertDescription>
              저장된 정산값과 현재 상세 내역이 다릅니다. 정산 재생성이 필요한지 확인하세요.
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Metric label="저장 입고" value={`${formatQuantity(storedClosingMetrics.purchaseQuantity)}권`} tone={closingMetricMismatches.purchase ? "warning" : "default"} />
          <Metric label="저장 출고" value={`${formatQuantity(storedClosingMetrics.saleQuantity)}권`} tone={closingMetricMismatches.sale ? "warning" : "default"} />
          <Metric label="저장 기말" value={`${formatQuantity(storedClosingMetrics.endingQuantity)}권`} tone={closingMetricMismatches.ending ? "warning" : "default"} />
          <Metric label="저장 마진" value={formatCurrency(storedClosingMetrics.marginAmount)} tone={closingMetricMismatches.margin ? "warning" : "default"} />
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" aria-label="현재 상세 재계산">
          <Metric label="상세 입고" value={`${formatQuantity(detailClosing.purchaseQuantity)}권`} tone={closingMetricMismatches.purchase ? "warning" : "default"} />
          <Metric label="상세 출고" value={`${formatQuantity(detailClosing.saleQuantity)}권`} tone={closingMetricMismatches.sale ? "warning" : "default"} />
          <Metric label="상세 기말" value={`${formatQuantity(detailClosing.endingQuantity)}권`} tone={closingMetricMismatches.ending ? "warning" : "default"} />
          <Metric label="상세 마진" value={formatCurrency(detailClosing.textbookMarginAmount)} tone={closingMetricMismatches.margin ? "warning" : "default"} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={detailQuery}
              onChange={(event) => {
                setDetailQuery(event.target.value);
                setCopyStatus("");
              }}
              onBlur={(event) => setDetailQuery(normalizeStoredTextInput(event.target.value))}
              placeholder="교재·구분·위치 검색"
              aria-label="정산 상세 검색"
              autoComplete="off"
              enterKeyHint="search"
              className="h-9 pl-9"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="h-8 rounded-md px-2 tabular-nums">
              상세 {formatQuantity(filteredDetailRows.length)}/{formatQuantity(detailRows.length)}
            </Badge>
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={copyClosingDetail} disabled={isCopyingDetail}>
              <Copy className="mr-2 size-3.5" />
              {copyStatus || "복사"}
            </Button>
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border">
          <div className="overflow-x-auto">
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-[120px]">일시</TableHead>
                  <TableHead className="w-[120px]">구분</TableHead>
                  <TableHead>교재</TableHead>
                  <TableHead className="w-[96px]">위치</TableHead>
                  <TableHead className="w-[88px] text-right">수량</TableHead>
                  <TableHead className="w-[112px] text-right">금액</TableHead>
                  <TableHead className="w-[112px] text-right">마진</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDetailRows.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-muted-foreground">{formatCompactDateTime(item.at)}</TableCell>
                    <TableCell>{item.typeLabel}</TableCell>
                    <TableCell className="max-w-[320px] truncate font-medium">{item.textbookTitle}</TableCell>
                    <TableCell className="truncate">{item.locationName}</TableCell>
                    <TableCell className="text-right tabular-nums">{`${item.quantity > 0 ? "+" : ""}${formatQuantity(item.quantity)}`}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(item.amount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.marginAmount > 0 ? formatCurrency(item.marginAmount) : "-"}</TableCell>
                  </TableRow>
                ))}
                {filteredDetailRows.length === 0 ? (
                  <EmptyRow
                    colSpan={7}
                    label={detailRows.length === 0 ? "정산 상세 내역이 없습니다" : "검색 조건에 맞는 정산 상세가 없습니다"}
                    compact
                  />
                ) : null}
              </TableBody>
            </Table>
          </div>
        </div>
        <div className={dialogFooterClassName}>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
  if (requestFilter === "unregistered") {
    return "미등록 요청이 없습니다";
  }
  if (requestFilter === "orderable") {
    return "주문 가능한 요청이 없습니다";
  }
  if (mode === "request") {
    return "대기 중인 요청이 없습니다";
  }
  if (groupId === "requested") {
    return "주문 필요 건이 없습니다";
  }
  if (orderFilter === "waiting") {
    return "입고 대기 건이 없습니다";
  }
  if (orderFilter === "partial") {
    return "부분입고 건이 없습니다";
  }
  if (orderFilter === "returnable") {
    return "반품 요청 가능한 입고 건이 없습니다";
  }
  if (orderFilter === "returned") {
    return "반품 완료 건이 없습니다";
  }
  if (groupId === "ordered") {
    return "입고 대기 주문이 없습니다";
  }
  if (groupId === "partially_received") {
    return "부분입고 건이 없습니다";
  }
  return "입고 완료 건이 없습니다";
}

function getPurchaseProcessEmptyHint(
  mode: "request" | "order",
  groupId: string,
  requestFilter: PurchaseRequestFilter,
  orderFilter: PurchaseOrderFilter,
  searchQuery = "",
) {
  if (text(searchQuery)) {
    return "검색어를 지우면 현재 탭의 전체 흐름을 다시 볼 수 있습니다.";
  }
  if (requestFilter === "unregistered") {
    return "직접 입력된 요청은 교보 검색으로 확인한 뒤 기존 교재 연결 또는 마스터 등록으로 넘깁니다.";
  }
  if (requestFilter === "orderable") {
    return "기존 마스터와 연결된 요청만 선택 주문으로 넘길 수 있습니다.";
  }
  if (mode === "request") {
    return "선생님 요청은 여기서 받고, 관리팀 검토 후 주문·입고로 넘깁니다.";
  }
  if (groupId === "requested") {
    return "요청에서 확정된 교재가 주문 대기 목록에 올라옵니다.";
  }
  if (orderFilter === "partial" || groupId === "partially_received") {
    return "거래명세표 수량과 실제 입고 수량이 다를 때만 남습니다.";
  }
  if (orderFilter === "returnable") {
    return "입고 수량이 있는 건만 공급처 반품 요청서로 정리할 수 있습니다.";
  }
  if (orderFilter === "returned" || groupId === "returned") {
    return "반품 처리된 건은 재고와 주문 이력을 함께 확인합니다.";
  }
  if (orderFilter === "waiting" || groupId === "ordered") {
    return "주문 완료 건은 입고 수량을 입력하면 다음 단계로 이동합니다.";
  }
  return "입고 완료 건은 재고와 정산에서 이어서 확인합니다.";
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
  if (statusFilter === "returned") {
    return "반품 이력이 없습니다";
  }
  if (statusFilter === "cancelled") {
    return "취소 이력이 없습니다";
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

function getSalesProcessEmptyHint(groupId: string, statusFilter: SalesProcessFilter, searchQuery = "") {
  if (text(searchQuery)) {
    return "검색어를 지우면 출고 대기와 완료 내역을 다시 볼 수 있습니다.";
  }
  if (statusFilter === "waiting" || groupId === "charged") {
    return "수업과 학생이 확정된 교재만 출고 대기 목록에 올라옵니다.";
  }
  if (statusFilter === "issued" || groupId === "issued") {
    return "출고 처리된 교재는 재고 이동과 정산에서 이어서 확인합니다.";
  }
  if (statusFilter === "returned" || groupId === "returned") {
    return "반품 이력은 최고관리자가 테스트 기록까지 선택해 정리할 수 있습니다.";
  }
  if (statusFilter === "cancelled" || groupId === "cancelled") {
    return "취소 이력은 최고관리자가 테스트 기록까지 선택해 정리할 수 있습니다.";
  }
  return "취소와 반품은 완료 흐름과 분리해서 관리합니다.";
}

function ProcessGroupEmptyState({
  label,
  hint,
  actionLabel,
  onAction,
}: {
  label: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div aria-live="polite" className="flex flex-col gap-3 border-t bg-muted/10 px-4 py-5 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="font-medium text-foreground">{label}</div>
        {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      </div>
      {actionLabel && onAction ? (
        <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 rounded-md bg-background" aria-label={actionLabel} title={actionLabel} onClick={onAction}>
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
  publishers,
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
  onBulkReceive,
  onBulkReturn,
  onScopeChange,
  onRequestFilterChange,
  onOrderFilterChange,
  onMoveLine,
  onDeleteLine,
  onReturnLine,
  onClearSearch,
}: {
  mode: "request" | "order";
  orders: Row[];
  lines: Row[];
  textbooks: Row[];
  publishers: Row[];
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
  onBulkReceive?: () => void;
  onBulkReturn?: () => void;
  onScopeChange: (scope: PurchaseBoardScope) => void;
  onRequestFilterChange: (filter: PurchaseRequestFilter) => void;
  onOrderFilterChange: (filter: PurchaseOrderFilter) => void;
  onMoveLine: (line: Row, order: Row | undefined, status: PurchaseKanbanStatus, draft?: PurchaseKanbanDraft) => void;
  onDeleteLine: (line: Row, order: Row | undefined) => void;
  onReturnLine?: (line: Row, order: Row | undefined) => void;
  onClearSearch: () => void;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [handoffDialogOpen, setHandoffDialogOpen] = useState(false);
  const [returnHandoffDialogOpen, setReturnHandoffDialogOpen] = useState(false);
  const grouped = useMemo(() => groupPurchaseLinesByStatus({ orders, lines }) as Record<string, Row[]>, [lines, orders]);
  const ordersById = useMemo(() => new Map(orders.map((order) => [getRecordId(order), order])), [orders]);
  const requestFilterOptions = useMemo(
    () => [
    { value: "all", label: "검토 전체" },
    { value: "unregistered", label: "미등록 요청" },
    { value: "orderable", label: "등록 교재" },
    ] satisfies Array<{ value: PurchaseRequestFilter; label: string }>,
    [],
  );
  const groups = useMemo(() => mode === "request"
    ? [{ id: "requested", title: "요청대기" }]
    : [
        { id: "requested", title: "주문 필요" },
        { id: "ordered", title: "주문완료" },
        { id: "partially_received", title: "부분입고" },
        { id: "received", title: "입고완료" },
        { id: "returned", title: "반품" },
        { id: "cancelled", title: "취소" },
      ], [mode]);
  const visibleGroups = useMemo(() => {
    if (mode === "request") {
      return groups;
    }
    if (orderFilter === "waiting") {
      return groups.filter((group) => group.id === "requested" || group.id === "ordered" || group.id === "partially_received");
    }
    if (orderFilter === "partial") {
      return groups.filter((group) => group.id === "partially_received");
    }
    if (orderFilter === "returnable") {
      return groups.filter((group) => group.id === "partially_received" || group.id === "received");
    }
    if (orderFilter === "returned") {
      return groups.filter((group) => group.id === "returned");
    }
    return groups;
  }, [groups, mode, orderFilter]);
  const showBulkPurchaseSelection = mode === "order" && Boolean(onToggleLine && onToggleVisibleLines);
  const purchaseProcessColumns = useMemo(
    () => buildPurchaseProcessColumns(mode, showBulkPurchaseSelection),
    [mode, showBulkPurchaseSelection],
  );
  const {
    isColumnVisible: isPurchaseColumnVisible,
    visibleColumnCount: visiblePurchaseColumnCount,
    columnSettingsControl,
  } = useDataTableColumns(`textbook-purchase-process-${mode}`, purchaseProcessColumns);
  const selectedLineIdSet = useMemo(() => new Set(selectedLineIds), [selectedLineIds]);

  function toggleGroup(id: string) {
    setCollapsedGroups((current) => ({ ...current, [id]: !current[id] }));
  }

  const shouldShowRequestLineForFilter = useCallback((line: Row, filter: PurchaseRequestFilter) => {
    if (filter === "all") {
      return true;
    }
    const orderStatus = text(line.status || getPurchaseLineOrder(line, ordersById)?.status);
    if (mode === "order" && orderStatus !== "requested") {
      return false;
    }
    const order = ((line.order || getPurchaseLineOrder(line, ordersById)) || {}) as Row;
    const draft = buildPurchaseCardDraft(line, order);
    const textbook = getTextbookById(textbooks, draft.textbookId || draft.requestedTextbookTitle);
    if (filter === "unregistered") {
      return !textbook;
    }
    return Boolean(textbook);
  }, [mode, ordersById, textbooks]);

  const shouldShowOrderGroupForFilter = useCallback((groupId: string, filter: PurchaseOrderFilter) => {
    if (mode === "request") return true;
    if (filter === "waiting") return groupId === "requested" || groupId === "ordered" || groupId === "partially_received";
    if (filter === "partial") return groupId === "partially_received";
    if (filter === "returnable") return groupId === "partially_received" || groupId === "received";
    if (filter === "returned") return groupId === "returned";
    return true;
  }, [mode]);

  const shouldShowOrderLineForFilter = useCallback((line: Row, groupId: string, filter: PurchaseOrderFilter) => {
    if (mode === "request") return true;
    if (filter === "returnable") {
      const order = getPurchaseLineOrder(line, ordersById);
      const status = text(line.status || order?.status || groupId);
      return numberValue(line.received_quantity || line.receivedQuantity) > 0 && status !== "returned" && status !== "cancelled";
    }
    if (filter === "returned") {
      const order = getPurchaseLineOrder(line, ordersById);
      return text(line.status || order?.status || groupId) === "returned";
    }
    return true;
  }, [mode, ordersById]);

  const searchMatchedPurchaseRowsByGroup = useMemo(() => {
    const rowsByGroup = new Map<string, Row[]>();
    for (const group of groups) {
      rowsByGroup.set(group.id, (grouped[group.id] || []).filter((line) => {
        const order = ((line.order || getPurchaseLineOrder(line, ordersById)) || {}) as Row;
        if (!shouldShowOperationalPurchaseLine(line, order, textbooks)) {
          return false;
        }
        return matchesPurchaseLineQuery({
          line,
          order,
          query: searchQuery,
          textbooks,
          publishers,
          classes,
          suppliers,
          publisherSupplierLinks,
          locations,
        });
      }));
    }
    return rowsByGroup;
  }, [classes, grouped, groups, locations, ordersById, publisherSupplierLinks, publishers, searchQuery, suppliers, textbooks]);

  const getVisiblePurchaseRows = useCallback((groupId: string, nextRequestFilter = requestFilter, nextBoardScope = boardScope, nextOrderFilter = orderFilter) => {
    return (searchMatchedPurchaseRowsByGroup.get(groupId) || [])
      .filter((line) => shouldShowPurchaseLineOnBoard(line, nextBoardScope))
      .filter((line) => shouldShowRequestLineForFilter(line, nextRequestFilter))
      .filter((line) => shouldShowOrderLineForFilter(line, groupId, nextOrderFilter));
  }, [boardScope, orderFilter, requestFilter, searchMatchedPurchaseRowsByGroup, shouldShowOrderLineForFilter, shouldShowRequestLineForFilter]);

  const visiblePurchaseRowsByGroup = useMemo(() => {
    const rowsByGroup = new Map<string, Row[]>();
    for (const group of visibleGroups) {
      rowsByGroup.set(group.id, getVisiblePurchaseRows(group.id));
    }
    return rowsByGroup;
  }, [getVisiblePurchaseRows, visibleGroups]);
  const getCurrentVisiblePurchaseRows = useCallback(
    (groupId: string) => visiblePurchaseRowsByGroup.get(groupId) || [],
    [visiblePurchaseRowsByGroup],
  );
  const visiblePurchaseRows = useMemo(
    () => visibleGroups.flatMap((group) => getCurrentVisiblePurchaseRows(group.id)),
    [getCurrentVisiblePurchaseRows, visibleGroups],
  );

  const visibleRowCount = visiblePurchaseRows.length;
  const visibleRequestedTotal = visiblePurchaseRows.reduce(
    (sum, line) => sum + numberValue(line.requested_quantity || line.requestedQuantity),
    0,
  );
  const visibleOrderedTotal = visiblePurchaseRows.reduce(
    (sum, line) => sum + numberValue(line.ordered_quantity || line.orderedQuantity),
    0,
  );
  const visibleReceivedTotal = visiblePurchaseRows.reduce(
    (sum, line) => sum + numberValue(line.received_quantity || line.receivedQuantity),
    0,
  );
  const renderedGroups = visibleGroups.filter((group) => getCurrentVisiblePurchaseRows(group.id).length > 0);
  const emptyGroupId = visibleGroups[0]?.id || (mode === "request" ? "requested" : "ordered");
  const purchaseProcessFilterCounts = useMemo(() => {
    const requestCounts = Object.fromEntries(purchaseRequestFilterValues.map((filter) => [filter, 0])) as Record<PurchaseRequestFilter, number>;
    const orderCounts = Object.fromEntries(purchaseOrderFilterValues.map((filter) => [filter, 0])) as Record<PurchaseOrderFilter, number>;
    const boardScopeCounts = Object.fromEntries(purchaseBoardScopeValues.map((scope) => [scope, 0])) as Record<PurchaseBoardScope, number>;

    for (const filter of purchaseRequestFilterValues) {
      requestCounts[filter] = groups.reduce((sum, group) => sum + getVisiblePurchaseRows(group.id, filter).length, 0);
    }
    for (const filter of purchaseOrderFilterValues) {
      orderCounts[filter] = groups.reduce((sum, group) => {
        if (!shouldShowOrderGroupForFilter(group.id, filter)) {
          return sum;
        }
        return sum + getVisiblePurchaseRows(group.id, requestFilter, boardScope, filter).length;
      }, 0);
    }
    for (const scope of purchaseBoardScopeValues) {
      boardScopeCounts[scope] = groups.reduce((sum, group) => sum + getVisiblePurchaseRows(group.id, requestFilter, scope).length, 0);
    }

    return { request: requestCounts, order: orderCounts, boardScope: boardScopeCounts };
  }, [boardScope, getVisiblePurchaseRows, groups, requestFilter, shouldShowOrderGroupForFilter]);
  const purchaseProcessActionIds = useMemo(() => {
    const orderable: string[] = [];
    const receivable: string[] = [];
    const returnable: string[] = [];
    if (mode !== "order") {
      return { orderable, receivable, returnable };
    }

    for (const line of visiblePurchaseRows) {
      const lineId = getRecordId(line);
      if (!lineId) {
        continue;
      }
      const order = getPurchaseLineOrder(line, ordersById);
      const status = text(line.status || order?.status);
      if (status === "requested" && isOrderablePurchaseRequestLine(line, order, textbooks)) {
        orderable.push(lineId);
      }
      if (status === "ordered" || status === "partially_received") {
        receivable.push(lineId);
      }
      if (numberValue(line.received_quantity || line.receivedQuantity) > 0 && status !== "returned" && status !== "cancelled") {
        returnable.push(lineId);
      }
    }
    return { orderable, receivable, returnable };
  }, [mode, ordersById, textbooks, visiblePurchaseRows]);
  const visibleOrderableRequestLineIds = purchaseProcessActionIds.orderable;
  const visibleReceivableLineIds = purchaseProcessActionIds.receivable;
  const visibleReturnableLineIds = purchaseProcessActionIds.returnable;
  const selectedOrderableRequestCount = useMemo(
    () => visibleOrderableRequestLineIds.filter((id) => selectedLineIdSet.has(id)).length,
    [selectedLineIdSet, visibleOrderableRequestLineIds],
  );
  const selectedReceivableCount = useMemo(
    () => visibleReceivableLineIds.filter((id) => selectedLineIdSet.has(id)).length,
    [selectedLineIdSet, visibleReceivableLineIds],
  );
  const selectedReturnableCount = useMemo(
    () => visibleReturnableLineIds.filter((id) => selectedLineIdSet.has(id)).length,
    [selectedLineIdSet, visibleReturnableLineIds],
  );
  const visibleActionablePurchaseLineIds = useMemo(
    () => [...new Set([...visibleOrderableRequestLineIds, ...visibleReceivableLineIds, ...visibleReturnableLineIds])],
    [visibleOrderableRequestLineIds, visibleReceivableLineIds, visibleReturnableLineIds],
  );
  const visibleActionablePurchaseLineIdSet = useMemo(
    () => new Set(visibleActionablePurchaseLineIds),
    [visibleActionablePurchaseLineIds],
  );
  const selectedProcessLineCount = useMemo(
    () => visibleActionablePurchaseLineIds.filter((id) => selectedLineIdSet.has(id)).length,
    [selectedLineIdSet, visibleActionablePurchaseLineIds],
  );
  const hasProcessSearchQuery = Boolean(text(searchQuery));
  const totalProcessRowCount = groups.reduce((sum, group) => sum + (grouped[group.id] || []).length, 0);
  const showProcessControls = totalProcessRowCount > 0 || hasProcessSearchQuery;
  const hasHiddenProcessRows =
    mode === "order" && totalProcessRowCount > 0 && visibleRowCount === 0 && !hasProcessSearchQuery;
  const showProcessSummary = visibleRowCount > 0 || hasProcessSearchQuery;
  const visibleBoardScopeOptions = (Object.keys(purchaseBoardScopeLabels) as PurchaseBoardScope[]).filter(
    (scope) => boardScope === scope || purchaseProcessFilterCounts.boardScope[scope] > 0,
  );
  const visibleOrderFilterOptions = (Object.keys(purchaseOrderFilterLabels) as PurchaseOrderFilter[]).filter(
    (filter) => orderFilter === filter || purchaseProcessFilterCounts.order[filter] > 0,
  );
  const visibleRequestFilterOptions = mode === "order"
    ? requestFilterOptions.filter((option) => requestFilter === option.value || purchaseProcessFilterCounts.request[option.value] > 0)
    : [];
  const activeRequestFilterLabel = requestFilterOptions.find((option) => option.value === requestFilter)?.label || "";
  const activePurchaseFilterCount = mode === "order"
    ? Number(boardScope !== "active") + Number(orderFilter !== "all") + Number(requestFilter !== "all")
    : 0;
  const activePurchaseFilterLabel = [
    boardScope !== "active" ? purchaseBoardScopeLabels[boardScope] : "",
    orderFilter !== "all" ? purchaseOrderFilterLabels[orderFilter] : "",
    requestFilter !== "all" ? activeRequestFilterLabel : "",
  ].filter(Boolean).join(" · ") || "기본";
  const processSummaryParts = [
    `표시 ${formatQuantity(visibleRowCount)}건`,
    visibleRequestedTotal > 0 ? `요청 ${formatQuantity(visibleRequestedTotal)}` : "",
    mode === "order" && visibleOrderedTotal > 0 ? `주문 ${formatQuantity(visibleOrderedTotal)}` : "",
    mode === "order" && visibleReceivedTotal > 0 ? `입고 ${formatQuantity(visibleReceivedTotal)}` : "",
  ].filter(Boolean);
  const processSummaryText = processSummaryParts.join(" · ");
  const purchaseHandoffGroups = useMemo(() => mode === "order"
    ? buildPurchaseSupplierHandoffGroups({
        rows: visiblePurchaseRows,
        ordersById,
        textbooks,
        publishers,
        suppliers,
        publisherSupplierLinks,
        locations,
        classes,
      })
    : [], [classes, locations, mode, ordersById, publisherSupplierLinks, publishers, suppliers, textbooks, visiblePurchaseRows]);
  const returnHandoffGroups = useMemo(() => mode === "order"
    ? buildPurchaseSupplierReturnHandoffGroups({
        rows: visiblePurchaseRows,
        ordersById,
        textbooks,
        publishers,
        suppliers,
        publisherSupplierLinks,
        locations,
        classes,
      })
    : [], [classes, locations, mode, ordersById, publisherSupplierLinks, publishers, suppliers, textbooks, visiblePurchaseRows]);
  const emptyActionLabel = hasProcessSearchQuery
    ? "검색 초기화"
    : hasHiddenProcessRows
      ? "전체 보기"
      : mode === "request" ? "요청 바로 추가" : "주문 바로 추가";
  const handleEmptyAction = () => {
    if (hasProcessSearchQuery) {
      onClearSearch();
      return;
    }
    if (hasHiddenProcessRows) {
      onScopeChange("all");
      onRequestFilterChange("all");
      onOrderFilterChange("all");
      return;
    }
    onAddLine();
  };

  return (
    <>
      {mode === "order" ? (
        <>
          <TextbookHandoffDialog
            open={handoffDialogOpen}
            onOpenChange={setHandoffDialogOpen}
            title="공급처 주문 전달"
            description="보이는 주문 건을 공급처별 이미지, PDF로 정리합니다."
            groups={purchaseHandoffGroups}
            emptyLabel="전달할 주문 건이 없습니다"
            idPrefix="purchase-handoff"
            format="purchase-order"
          />
          <TextbookHandoffDialog
            open={returnHandoffDialogOpen}
            onOpenChange={setReturnHandoffDialogOpen}
            title="공급처 반품 요청서"
            description="보이는 반품 가능 건을 공급처별 이미지, PDF로 정리합니다."
            groups={returnHandoffGroups}
            emptyLabel="반품 요청할 입고 건이 없습니다"
            idPrefix="purchase-return-handoff"
            format="purchase-return"
          />
        </>
      ) : null}
      <div
        className="min-w-0 overflow-hidden rounded-lg border bg-background max-w-[calc(100vw-2rem)] md:max-w-none"
        aria-label={mode === "request" ? "교재 요청 목록" : "교재 주문·입고 목록"}
      >
      {showProcessControls ? (
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b p-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {mode === "order" ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant={activePurchaseFilterCount > 0 ? "default" : "outline"}
                  size="sm"
                  className="h-8 max-w-full rounded-md"
                  aria-label="주문·입고 보기 필터"
                >
                  <SlidersHorizontal className="mr-2 size-3.5" />
                  <span className="shrink-0">필터</span>
                  <span className="min-w-0 max-w-[14rem] truncate text-xs opacity-80">{activePurchaseFilterLabel}</span>
                  {activePurchaseFilterCount > 0 ? (
                    <span className="ml-1 rounded bg-primary-foreground/20 px-1.5 text-[11px] font-semibold">
                      {formatQuantity(activePurchaseFilterCount)}
                    </span>
                  ) : null}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-3">
                <div className="grid gap-3">
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">범위</div>
                    <div className="grid grid-cols-3 gap-1">
                      {visibleBoardScopeOptions.map((scope) => (
                        <Button
                          key={scope}
                          type="button"
                          variant={boardScope === scope ? "default" : "outline"}
                          size="sm"
                          className="h-8 justify-between rounded-md px-2"
                          aria-pressed={boardScope === scope}
                          onClick={() => onScopeChange(scope)}
                        >
                          <span className="truncate">{purchaseBoardScopeLabels[scope]}</span>
                          <span className={cn(
                            "ml-2 rounded px-1.5 text-[11px] font-semibold",
                            boardScope === scope ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
                          )}>
                            {formatQuantity(purchaseProcessFilterCounts.boardScope[scope])}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">단계</div>
                    <div className="grid grid-cols-3 gap-1">
                      {visibleOrderFilterOptions.map((filter) => (
                        <Button
                          key={filter}
                          type="button"
                          variant={orderFilter === filter ? "default" : "outline"}
                          size="sm"
                          className="h-8 justify-between rounded-md px-2"
                          aria-pressed={orderFilter === filter}
                          onClick={() => onOrderFilterChange(filter)}
                        >
                          <span className="truncate">{purchaseOrderFilterLabels[filter]}</span>
                          <span className={cn(
                            "ml-2 rounded px-1.5 text-[11px] font-semibold",
                            orderFilter === filter ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
                          )}>
                            {formatQuantity(purchaseProcessFilterCounts.order[filter])}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </div>
                  {visibleRequestFilterOptions.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-muted-foreground">검토</div>
                      <div className="grid grid-cols-3 gap-1">
                        {visibleRequestFilterOptions.map((option) => (
                          <Button
                            key={option.value}
                            type="button"
                            variant={requestFilter === option.value ? "default" : "outline"}
                            size="sm"
                            className="h-8 justify-between rounded-md px-2"
                            aria-pressed={requestFilter === option.value}
                            onClick={() => onRequestFilterChange(option.value)}
                          >
                            <span className="truncate">{option.label}</span>
                            <span className={cn(
                              "ml-2 rounded px-1.5 text-[11px] font-semibold",
                              requestFilter === option.value ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
                            )}>
                              {formatQuantity(purchaseProcessFilterCounts.request[option.value])}
                            </span>
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {activePurchaseFilterCount > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 justify-self-start rounded-md px-2"
                      onClick={() => {
                        onScopeChange("active");
                        onOrderFilterChange("all");
                        onRequestFilterChange("all");
                      }}
                    >
                      기본 보기
                    </Button>
                  ) : null}
                </div>
              </PopoverContent>
            </Popover>
          ) : null}
          {showProcessSummary ? (
            <div className="min-w-0 truncate text-sm text-muted-foreground" aria-live="polite">
              {processSummaryText}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {visibleRowCount > 0 ? (
            <div role="group" aria-label="교재 처리표 컬럼 구성" className="shrink-0">
              {columnSettingsControl}
            </div>
          ) : null}
          {mode === "order" && selectedProcessLineCount > 0 ? (
            <>
              <Badge variant="secondary" className="h-8 rounded-md px-2 tabular-nums">
                선택 {formatQuantity(selectedProcessLineCount)}
              </Badge>
              {selectedOrderableRequestCount > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={selectedOrderableRequestCount === 0}
                  aria-label="선택 요청 일괄 주문"
                  title="선택 요청 일괄 주문"
                  onClick={onBulkOrder}
                >
                  선택 주문
                </Button>
              ) : null}
              {selectedReceivableCount > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={selectedReceivableCount === 0}
                  aria-label="선택 주문 일괄 입고"
                  title="선택 주문 일괄 입고"
                  onClick={onBulkReceive}
                >
                  선택 입고
                </Button>
              ) : null}
              {selectedReturnableCount > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={selectedReturnableCount === 0}
                  aria-label="선택 입고 건 공급처 반품"
                  title="선택 입고 건 공급처 반품"
                  onClick={onBulkReturn}
                >
                  선택 반품
                </Button>
              ) : null}
            </>
          ) : null}
          {visibleRowCount > 0 ? (
            mode === "request" ? (
              <Button type="button" size="sm" className="shrink-0" aria-label="교재 요청 추가" title="교재 요청 추가" onClick={onAddLine}>
                <Plus className="mr-2 size-4" />
                요청 추가
              </Button>
            ) : (
              <>
                {purchaseHandoffGroups.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    aria-label="공급처별 주문 전달 열기"
                    title="공급처별 주문 전달"
                    onClick={() => setHandoffDialogOpen(true)}
                  >
                    <Copy className="mr-2 size-3.5" />
                    전달
                  </Button>
                ) : null}
                {returnHandoffGroups.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    aria-label="공급처 반품 요청서 열기"
                    title="공급처 반품 요청서"
                    onClick={() => setReturnHandoffDialogOpen(true)}
                  >
                    <Truck className="mr-2 size-3.5" />
                    반품 요청서
                  </Button>
                ) : null}
                <Button type="button" size="sm" className="shrink-0" aria-label="교재 주문 추가" title="교재 주문 추가" onClick={onAddLine}>
                  <Plus className="mr-2 size-4" />
                  주문 추가
                </Button>
              </>
            )
          ) : null}
        </div>
      </div>
      ) : null}

      {visibleRowCount === 0 ? (
        <ProcessGroupEmptyState
          label={getPurchaseProcessEmptyLabel(mode, emptyGroupId, requestFilter, orderFilter, searchQuery)}
          hint={showProcessControls && !hasHiddenProcessRows ? getPurchaseProcessEmptyHint(mode, emptyGroupId, requestFilter, orderFilter, searchQuery) : undefined}
          actionLabel={emptyActionLabel}
          onAction={handleEmptyAction}
        />
      ) : (
        <div className="grid gap-0">
          {renderedGroups.map((group) => {
          const rows = getCurrentVisiblePurchaseRows(group.id);
          const displayRows = buildPurchaseDisplayRows(rows, ordersById, textbooks);
          const collapsed = Boolean(collapsedGroups[group.id]);
          const studentRequestedTotal = getPurchaseDisplayScopeQuantity(rows, "student", "requested");
          const studentOrderedTotal = getPurchaseDisplayScopeQuantity(rows, "student", "ordered");
          const studentReceivedTotal = getPurchaseDisplayScopeQuantity(rows, "student", "received");
          const teacherRequestedTotal = getPurchaseDisplayScopeQuantity(rows, "teacher", "requested");
          const teacherOrderedTotal = getPurchaseDisplayScopeQuantity(rows, "teacher", "ordered");
          const teacherReceivedTotal = getPurchaseDisplayScopeQuantity(rows, "teacher", "received");
          const requestedTotal = studentRequestedTotal + teacherRequestedTotal;
          const orderedTotal = studentOrderedTotal + teacherOrderedTotal;
          const receivedTotal = studentReceivedTotal + teacherReceivedTotal;
          const groupActionableLineIds: string[] = [];
          for (const line of rows) {
            const lineId = getRecordId(line);
            if (lineId && visibleActionablePurchaseLineIdSet.has(lineId)) {
              groupActionableLineIds.push(lineId);
            }
          }
          const groupSelectedActionableCount = groupActionableLineIds.filter((id) => selectedLineIdSet.has(id)).length;
          const groupAllActionableSelected =
            groupActionableLineIds.length > 0 && groupSelectedActionableCount === groupActionableLineIds.length;
          const groupSomeActionableSelected =
            groupSelectedActionableCount > 0 && !groupAllActionableSelected;
          const groupSummaryText = [
            `${formatQuantity(displayRows.length)}건`,
            requestedTotal > 0 ? `요청 ${formatQuantity(requestedTotal)}` : "",
            mode === "order" && orderedTotal > 0 ? `주문 ${formatQuantity(orderedTotal)}` : "",
            mode === "order" && receivedTotal > 0 ? `입고 ${formatQuantity(receivedTotal)}` : "",
          ].filter(Boolean).join(" · ");

          return (
            <section key={group.id} className="min-w-0 overflow-hidden border-b last:border-b-0">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-3 text-left text-sm font-medium hover:bg-muted/60"
                aria-expanded={!collapsed}
                aria-label={`${group.title} 그룹 ${collapsed ? "펼치기" : "접기"} · ${groupSummaryText}`}
                title={groupSummaryText}
                onClick={() => toggleGroup(group.id)}
              >
                {collapsed ? <ChevronRight className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                <span className={cn("size-2 rounded-full", processStatusDotClass(group.id))} />
                <span>{group.title}</span>
                <span className="ml-auto min-w-0 truncate text-xs font-normal tabular-nums text-muted-foreground">
                  {groupSummaryText}
                </span>
              </button>
              {!collapsed && rows.length > 0 ? (
                <>
                <div data-testid="textbook-purchase-process-mobile-list" className="grid min-w-0 max-w-full gap-2 overflow-hidden p-2 md:hidden">
                  {displayRows.map((displayRow) => {
                    const line = displayRow.line;
                    const displayLines = displayRow.lines;
                    const order = ((line.order || getPurchaseLineOrder(line, ordersById)) || {}) as Row;
                    const lineId = getRecordId(line);
                    const displayLineIds = displayLines.map((scopeLine) => getRecordId(scopeLine)).filter(Boolean);
                    const displayActionableLineIds = displayLineIds.filter((id) => visibleActionablePurchaseLineIdSet.has(id));
                    const displayAllActionableSelected =
                      displayActionableLineIds.length > 0 && displayActionableLineIds.every((id) => selectedLineIdSet.has(id));
                    const displaySomeActionableSelected =
                      displayActionableLineIds.some((id) => selectedLineIdSet.has(id)) && !displayAllActionableSelected;
                    const draft = buildPurchaseCardDraft(line, order);
                    const status = ((text(line.status || order.status) || group.id) as PurchaseKanbanStatus);
                    const textbook = getTextbookById(textbooks, draft.textbookId || draft.requestedTextbookTitle);
                    const textbookTitle = getPurchaseTextbookTitle(line, textbook);
                    const configuredSupplierId = getConfiguredSupplierIdForTextbook(textbook, publisherSupplierLinks, publishers) || draft.supplierId;
                    const unitCost = getConfiguredTextbookPurchaseUnitCost(textbook, configuredSupplierId, suppliers, draft.unitCost, draft.copyScope);
                    const locationName = getLocationName(locations, draft.locationId) || "-";
                    const classRecord = getClassById(classes, draft.classId);
                    const classStudentCount = getClassStudentCount(classRecord, students);
                    const quantityFit = getPurchaseQuantityClassFit(String(getPurchaseDisplayScopeQuantity(displayLines, "student", "requested")), classStudentCount);
                    const ordered = getPurchaseDisplayQuantity(displayLines, "ordered");
                    const received = getPurchaseDisplayQuantity(displayLines, "received");
                    const nextStatus = purchaseNextStatus(status);
                    const processAction = purchaseProcessAction(status);
                    const isMissingTextbookRequest = status === "requested" && !textbook;
                    const isReturnablePurchaseLine = mode === "order" && received > 0 && status !== "returned" && status !== "cancelled";
                    const isCancelablePurchaseLine = mode === "request" || (status !== "returned" && status !== "cancelled" && !isReturnablePurchaseLine);

                    return (
                      <article key={`mobile-${displayRow.id}`} className="min-w-0 rounded-md border bg-background p-3 shadow-xs">
                        <div className="flex min-w-0 items-start gap-3">
                          {showBulkPurchaseSelection && isPurchaseColumnVisible("select") ? (
                            <Checkbox
                              checked={displayAllActionableSelected || (displaySomeActionableSelected && "indeterminate")}
                              disabled={displayActionableLineIds.length === 0}
                              onCheckedChange={(value) => onToggleVisibleLines?.(displayActionableLineIds, value === true)}
                              title={`${textbookTitle} 일괄 처리 선택`}
                              aria-label={`${textbookTitle} 일괄 처리 선택`}
                              className="mt-1 shrink-0"
                            />
                          ) : null}
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-start justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => onSelectLine(line, order)}
                                aria-label={`${textbookTitle} ${mode === "request" ? "요청" : "주문·입고"} 상세 열기`}
                                title={textbookTitle}
                                className="min-w-0 flex-1 truncate text-left text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              >
                                {textbookTitle}
                              </button>
                              <Badge variant="outline" className={cn("shrink-0 rounded-md", processStatusPillClass(status))}>
                                {purchaseStatusLabel(status, ordered, received)}
                              </Badge>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                              <span>{getSupplierName(suppliers, configuredSupplierId) || "총판 미지정"}</span>
                              <span>·</span>
                              <span>{formatPurchaseUnitCost(unitCost, textbook)}</span>
                              <span>·</span>
                              <span>{locationName}</span>
                              <span>·</span>
                              <span>{classRecord ? getClassName(classRecord) : "수업 미지정"}</span>
                            </div>
                          </div>
                        </div>
                        <div className={cn("mt-3 grid gap-2 text-center text-xs", mode === "order" ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>
                          {isPurchaseColumnVisible("studentRequested") ? (
                            <div className="rounded-md bg-sky-50/70 px-2 py-2 ring-1 ring-sky-100">
                              <div className="text-muted-foreground">학생용 요청</div>
                              <div className="mt-1 text-right font-medium tabular-nums">{formatQuantity(getPurchaseDisplayScopeQuantity(displayLines, "student", "requested"))}</div>
                            </div>
                          ) : null}
                          {mode === "order" && isPurchaseColumnVisible("studentOrdered") ? (
                            <div className="rounded-md bg-sky-50/70 px-2 py-2 ring-1 ring-sky-100">
                              <div className="text-muted-foreground">학생용 주문</div>
                              <div className="mt-1 text-right font-medium tabular-nums">{formatQuantity(getPurchaseDisplayScopeQuantity(displayLines, "student", "ordered"))}</div>
                            </div>
                          ) : null}
                          {mode === "order" && isPurchaseColumnVisible("studentReceived") ? (
                            <div className="rounded-md bg-sky-50/70 px-2 py-2 ring-1 ring-sky-100">
                              <div className="text-muted-foreground">학생용 입고</div>
                              <div className="mt-1 text-right font-medium tabular-nums">{formatQuantity(getPurchaseDisplayScopeQuantity(displayLines, "student", "received"))}</div>
                            </div>
                          ) : null}
                          {isPurchaseColumnVisible("teacherRequested") ? (
                            <div className="rounded-md bg-amber-50/70 px-2 py-2 ring-1 ring-amber-100">
                              <div className="text-muted-foreground">교사용 요청</div>
                              <div className="mt-1 text-right font-medium tabular-nums">{formatQuantity(getPurchaseDisplayScopeQuantity(displayLines, "teacher", "requested"))}</div>
                            </div>
                          ) : null}
                          {mode === "order" && isPurchaseColumnVisible("teacherOrdered") ? (
                            <div className="rounded-md bg-amber-50/70 px-2 py-2 ring-1 ring-amber-100">
                              <div className="text-muted-foreground">교사용 주문</div>
                              <div className="mt-1 text-right font-medium tabular-nums">{formatQuantity(getPurchaseDisplayScopeQuantity(displayLines, "teacher", "ordered"))}</div>
                            </div>
                          ) : null}
                          {mode === "order" && isPurchaseColumnVisible("teacherReceived") ? (
                            <div className="rounded-md bg-amber-50/70 px-2 py-2 ring-1 ring-amber-100">
                              <div className="text-muted-foreground">교사용 입고</div>
                              <div className="mt-1 text-right font-medium tabular-nums">{formatQuantity(getPurchaseDisplayScopeQuantity(displayLines, "teacher", "received"))}</div>
                            </div>
                          ) : null}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {displayLines.some((scopeLine) => getTextbookCopyScope(scopeLine) === "student") ? (
                            <Badge variant="outline" className="rounded-md">학생용</Badge>
                          ) : null}
                          {displayLines.some((scopeLine) => getTextbookCopyScope(scopeLine) === "teacher") ? (
                            <Badge variant="outline" className="rounded-md">교사용</Badge>
                          ) : null}
                          <Badge
                            variant="outline"
                            className={cn(
                              "ml-auto rounded-md tabular-nums",
                              quantityFit.tone === "danger" && "border-red-300 bg-red-50 text-red-700",
                              quantityFit.tone === "warning" && "border-amber-300 bg-amber-50 text-amber-700",
                              quantityFit.tone === "good" && "border-emerald-300 bg-emerald-50 text-emerald-700",
                            )}
                            title={quantityFit.label}
                          >
                            {quantityFit.label}
                          </Badge>
                        </div>
                        <div className="mt-3 grid min-w-0 grid-cols-2 gap-2 [&>button]:w-full">
                          {mode === "request" ? (
                            <Button type="button" variant="outline" size="sm" aria-label={`${textbookTitle} 요청 수정`} onClick={() => onSelectLine(line, order)}>
                              <Pencil className="mr-1 size-3.5" />
                              수정
                            </Button>
                          ) : (
                            <>
                              <Button type="button" variant="outline" size="sm" aria-label={`${textbookTitle} 주문·입고 수정`} onClick={() => onSelectLine(line, order)}>
                                <Pencil className="mr-1 size-3.5" />
                                수정
                              </Button>
                              {mode === "order" && isMissingTextbookRequest ? (
                                <>
                                  <Button type="button" variant="outline" size="sm" aria-label={`${textbookTitle} 마스터 등록`} onClick={() => onRegisterTextbook(line, order)}>
                                    마스터 등록
                                  </Button>
                                  {textbookTitle !== "-" ? (
                                    <Button type="button" variant="outline" size="sm" asChild>
                                      <a href={buildKyoboSearchUrl(textbookTitle)} target="_blank" rel="noreferrer" aria-label={`${textbookTitle} 교보문고 검색`} title={`${textbookTitle} 교보문고 검색`}>
                                        <Search className="mr-1 size-3.5" />
                                        교보 검색
                                      </a>
                                    </Button>
                                  ) : null}
                                </>
                              ) : null}
                              {nextStatus && !isMissingTextbookRequest ? (
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
                              {isReturnablePurchaseLine && onReturnLine ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  aria-label={`${textbookTitle} 공급처 반품`}
                                  disabled={saving === `purchase-return-${lineId}`}
                                  onClick={() => onReturnLine(line, order)}
                                >
                                  반품
                                </Button>
                              ) : null}
                            </>
                          )}
                          {isCancelablePurchaseLine ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              aria-label={`${textbookTitle} ${mode === "request" ? "요청" : "주문·입고"} 건 삭제`}
                              disabled={saving === `purchase-delete-${lineId}`}
                              onClick={() => onDeleteLine({ ...line, purchaseScopeLines: displayLines }, order)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
                <div className="hidden max-w-full overflow-x-auto md:block">
                  <Table
                    className={mode === "request" ? "w-full min-w-[1120px]" : "w-full min-w-[1440px]"}
                    aria-colcount={visiblePurchaseColumnCount}
                  >
                    <caption className="sr-only">{mode === "request" ? "교재 요청 처리 목록" : "교재 주문·입고 처리 목록"}</caption>
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow className="bg-muted/30">
                        {showBulkPurchaseSelection && isPurchaseColumnVisible("select") ? (
                          <TableHead className="w-10">
                            <Checkbox
                              checked={groupAllActionableSelected || (groupSomeActionableSelected && "indeterminate")}
                              disabled={groupActionableLineIds.length === 0}
                              onCheckedChange={(value) => onToggleVisibleLines?.(groupActionableLineIds, value === true)}
                              title="일괄 처리 가능한 행 전체 선택"
                              aria-label="일괄 처리 가능한 행 전체 선택"
                            />
                          </TableHead>
                        ) : null}
                        {isPurchaseColumnVisible("status") ? <TableHead className="w-[104px]">진행상태</TableHead> : null}
                        {mode === "order" ? (
                          <>
                            {isPurchaseColumnVisible("supplier") ? <TableHead className="w-[120px]">총판</TableHead> : null}
                            {isPurchaseColumnVisible("unitCost") ? <TableHead className="w-[96px] text-right">단가</TableHead> : null}
                          </>
                        ) : null}
                        {isPurchaseColumnVisible("eventAt") ? <TableHead className="w-[118px]">처리일시</TableHead> : null}
                        {isPurchaseColumnVisible("requester") ? <TableHead className="w-[104px]">요청자</TableHead> : null}
                        {isPurchaseColumnVisible("textbook") ? <TableHead>교재명</TableHead> : null}
                        {isPurchaseColumnVisible("location") ? <TableHead className="w-[88px]">위치</TableHead> : null}
                        {isPurchaseColumnVisible("class") ? <TableHead className="w-[140px]">수업</TableHead> : null}
                        {isPurchaseColumnVisible("studentRequested") ? <TableHead className="w-[96px] whitespace-nowrap text-right"><span className={purchaseQuantityHeaderPillClassName("student")}>학생용 요청</span></TableHead> : null}
                        {mode === "order" ? (
                          <>
                            {isPurchaseColumnVisible("studentOrdered") ? <TableHead className="w-[96px] whitespace-nowrap text-right"><span className={purchaseQuantityHeaderPillClassName("student")}>학생용 주문</span></TableHead> : null}
                            {isPurchaseColumnVisible("studentReceived") ? <TableHead className="w-[96px] whitespace-nowrap text-right"><span className={purchaseQuantityHeaderPillClassName("student")}>학생용 입고</span></TableHead> : null}
                          </>
                        ) : null}
                        {isPurchaseColumnVisible("teacherRequested") ? <TableHead className="w-[96px] whitespace-nowrap text-right"><span className={purchaseQuantityHeaderPillClassName("teacher")}>교사용 요청</span></TableHead> : null}
                        {mode === "order" ? (
                          <>
                            {isPurchaseColumnVisible("teacherOrdered") ? <TableHead className="w-[96px] whitespace-nowrap text-right"><span className={purchaseQuantityHeaderPillClassName("teacher")}>교사용 주문</span></TableHead> : null}
                            {isPurchaseColumnVisible("teacherReceived") ? <TableHead className="w-[96px] whitespace-nowrap text-right"><span className={purchaseQuantityHeaderPillClassName("teacher")}>교사용 입고</span></TableHead> : null}
                          </>
                        ) : null}
                        {isPurchaseColumnVisible("decision") ? <TableHead className="w-[96px]">판단</TableHead> : null}
                        {isPurchaseColumnVisible("action") ? <TableHead className={cn(mode === "request" ? "w-[160px]" : "w-[260px]", "text-right", stickyActionHeadClassName)}>작업</TableHead> : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayRows.map((displayRow) => {
                        const line = displayRow.line;
                        const displayLines = displayRow.lines;
                        const order = ((line.order || getPurchaseLineOrder(line, ordersById)) || {}) as Row;
                        const lineId = getRecordId(line);
                        const displayLineIds = displayLines.map((scopeLine) => getRecordId(scopeLine)).filter(Boolean);
                        const displayActionableLineIds = displayLineIds.filter((id) => visibleActionablePurchaseLineIdSet.has(id));
                        const displayAllActionableSelected =
                          displayActionableLineIds.length > 0 && displayActionableLineIds.every((id) => selectedLineIdSet.has(id));
                        const displaySomeActionableSelected =
                          displayActionableLineIds.some((id) => selectedLineIdSet.has(id)) && !displayAllActionableSelected;
                        const draft = buildPurchaseCardDraft(line, order);
                        const status = ((text(line.status || order.status) || group.id) as PurchaseKanbanStatus);
                        const textbook = getTextbookById(textbooks, draft.textbookId || draft.requestedTextbookTitle);
                        const textbookTitle = getPurchaseTextbookTitle(line, textbook);
                        const configuredSupplierId = getConfiguredSupplierIdForTextbook(textbook, publisherSupplierLinks, publishers) || draft.supplierId;
                        const unitCost = getConfiguredTextbookPurchaseUnitCost(textbook, configuredSupplierId, suppliers, draft.unitCost, draft.copyScope);
                        const locationName = getLocationName(locations, draft.locationId) || "-";
                        const classRecord = getClassById(classes, draft.classId);
                        const classStudentCount = getClassStudentCount(classRecord, students);
                        const quantityFit = getPurchaseQuantityClassFit(String(getPurchaseDisplayScopeQuantity(displayLines, "student", "requested")), classStudentCount);
                        const ordered = getPurchaseDisplayQuantity(displayLines, "ordered");
                        const received = getPurchaseDisplayQuantity(displayLines, "received");
                        const nextStatus = purchaseNextStatus(status);
                        const processAction = purchaseProcessAction(status);
                        const isMissingTextbookRequest = status === "requested" && !textbook;
                        const isReturnablePurchaseLine = mode === "order" && received > 0 && status !== "returned" && status !== "cancelled";
                        const isCancelablePurchaseLine = mode === "request" || (status !== "returned" && status !== "cancelled" && !isReturnablePurchaseLine);
                        return (
                          <TableRow key={displayRow.id} className={cn((selectedLineId === lineId || displayLineIds.includes(selectedLineId)) && "bg-primary/5")}>
                            {showBulkPurchaseSelection && isPurchaseColumnVisible("select") ? (
                              <TableCell>
                                <Checkbox
                                  checked={displayAllActionableSelected || (displaySomeActionableSelected && "indeterminate")}
                                  disabled={displayActionableLineIds.length === 0}
                                  onCheckedChange={(value) => onToggleVisibleLines?.(displayActionableLineIds, value === true)}
                                  title={`${textbookTitle} 일괄 처리 선택`}
                                  aria-label={`${textbookTitle} 일괄 처리 선택`}
                                />
                              </TableCell>
                            ) : null}
                            {isPurchaseColumnVisible("status") ? (
                            <TableCell>
                              <Badge variant="outline" className={cn("rounded-md", processStatusPillClass(status))}>
                                {purchaseStatusLabel(status, ordered, received)}
                              </Badge>
                            </TableCell>
                            ) : null}
                            {mode === "order" ? (
                              <>
                                {isPurchaseColumnVisible("supplier") ? (
                                  <TableCell className="max-w-[120px] truncate" title={getSupplierName(suppliers, configuredSupplierId) || "-"}>
                                    {getSupplierName(suppliers, configuredSupplierId) || "-"}
                                  </TableCell>
                                ) : null}
                                {isPurchaseColumnVisible("unitCost") ? (
                                  <TableCell className="text-right tabular-nums">{formatPurchaseUnitCost(unitCost, textbook)}</TableCell>
                                ) : null}
                              </>
                            ) : null}
                            {isPurchaseColumnVisible("eventAt") ? (
                              <TableCell className="text-muted-foreground">{formatCompactDateTime(getPurchaseEventAt(line, order, status))}</TableCell>
                            ) : null}
                            {isPurchaseColumnVisible("requester") ? <TableCell className="max-w-[104px] truncate">{draft.requestBy || "-"}</TableCell> : null}
                            {isPurchaseColumnVisible("textbook") ? (
                            <TableCell>
                              <button
                                type="button"
                                onClick={() => onSelectLine(line, order)}
                                aria-label={`${textbookTitle} ${mode === "request" ? "요청" : "주문·입고"} 상세 열기`}
                                title={textbookTitle}
                                className="max-w-[360px] truncate text-left font-medium hover:underline"
                              >
                                {textbookTitle}
                              </button>
                              {!textbook ? (
                                <div className="text-xs text-amber-700">미등록</div>
                              ) : null}
                            </TableCell>
                            ) : null}
                            {isPurchaseColumnVisible("location") ? <TableCell className="max-w-[88px] truncate" title={locationName}>{locationName}</TableCell> : null}
                            {isPurchaseColumnVisible("class") ? (
                              <TableCell className="max-w-[140px] truncate" title={classRecord ? getClassName(classRecord) : "수업 미지정"}>
                                {classRecord ? getClassName(classRecord) : "수업 미지정"}
                              </TableCell>
                            ) : null}
                            {isPurchaseColumnVisible("studentRequested") ? (
                              <TableCell className={purchaseQuantityCellClassName("student")}>
                                {formatQuantity(getPurchaseDisplayScopeQuantity(displayLines, "student", "requested"))}
                              </TableCell>
                            ) : null}
                            {mode === "order" ? (
                              <>
                                {isPurchaseColumnVisible("studentOrdered") ? (
                                  <TableCell className={purchaseQuantityCellClassName("student")}>
                                    {formatQuantity(getPurchaseDisplayScopeQuantity(displayLines, "student", "ordered"))}
                                  </TableCell>
                                ) : null}
                                {isPurchaseColumnVisible("studentReceived") ? (
                                  <TableCell className={purchaseQuantityCellClassName("student")}>
                                    {formatQuantity(getPurchaseDisplayScopeQuantity(displayLines, "student", "received"))}
                                  </TableCell>
                                ) : null}
                              </>
                            ) : null}
                            {isPurchaseColumnVisible("teacherRequested") ? (
                              <TableCell className={purchaseQuantityCellClassName("teacher")}>
                                {formatQuantity(getPurchaseDisplayScopeQuantity(displayLines, "teacher", "requested"))}
                              </TableCell>
                            ) : null}
                            {mode === "order" ? (
                              <>
                                {isPurchaseColumnVisible("teacherOrdered") ? (
                                  <TableCell className={purchaseQuantityCellClassName("teacher")}>
                                    {formatQuantity(getPurchaseDisplayScopeQuantity(displayLines, "teacher", "ordered"))}
                                  </TableCell>
                                ) : null}
                                {isPurchaseColumnVisible("teacherReceived") ? (
                                  <TableCell className={purchaseQuantityCellClassName("teacher")}>
                                    {formatQuantity(getPurchaseDisplayScopeQuantity(displayLines, "teacher", "received"))}
                                  </TableCell>
                                ) : null}
                              </>
                            ) : null}
                            {isPurchaseColumnVisible("decision") ? (
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "rounded-md tabular-nums",
                                  quantityFit.tone === "danger" && "border-red-300 bg-red-50 text-red-700",
                                  quantityFit.tone === "warning" && "border-amber-300 bg-amber-50 text-amber-700",
                                  quantityFit.tone === "good" && "border-emerald-300 bg-emerald-50 text-emerald-700",
                                )}
                                title={quantityFit.label}
                              >
                                {quantityFit.label}
                              </Badge>
                            </TableCell>
                            ) : null}
                            {isPurchaseColumnVisible("action") ? (
                            <TableCell className={stickyActionCellClassName}>
                              <div className="flex justify-end gap-1">
                                {mode === "request" ? (
                                  <>
                                    <Button type="button" variant="outline" size="sm" aria-label={`${textbookTitle} 요청 수정`} onClick={() => onSelectLine(line, order)}>
                                      <Pencil className="mr-1 size-3.5" />
                                      수정
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Button type="button" variant="outline" size="sm" aria-label={`${textbookTitle} 주문·입고 수정`} onClick={() => onSelectLine(line, order)}>
                                      <Pencil className="mr-1 size-3.5" />
                                      수정
                                    </Button>
                                    {mode === "order" && isMissingTextbookRequest ? (
                                      <>
                                        <Button type="button" variant="outline" size="sm" aria-label={`${textbookTitle} 마스터 등록`} onClick={() => onRegisterTextbook(line, order)}>
                                          마스터 등록
                                        </Button>
                                        {textbookTitle !== "-" ? (
                                          <Button type="button" variant="outline" size="sm" asChild>
                                            <a href={buildKyoboSearchUrl(textbookTitle)} target="_blank" rel="noreferrer" aria-label={`${textbookTitle} 교보문고 검색`} title={`${textbookTitle} 교보문고 검색`}>
                                              <Search className="mr-1 size-3.5" />
                                              교보 검색
                                            </a>
                                          </Button>
                                        ) : null}
                                      </>
                                    ) : null}
                                    {nextStatus && !isMissingTextbookRequest ? (
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
                                    {isReturnablePurchaseLine && onReturnLine ? (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        aria-label={`${textbookTitle} 공급처 반품`}
                                        disabled={saving === `purchase-return-${lineId}`}
                                        onClick={() => onReturnLine(line, order)}
                                      >
                                        반품
                                      </Button>
                                    ) : null}
                                  </>
                                )}
                                {isCancelablePurchaseLine ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    aria-label={`${textbookTitle} ${mode === "request" ? "요청" : "주문·입고"} 건 삭제`}
                                    disabled={saving === `purchase-delete-${lineId}`}
                                    onClick={() => onDeleteLine({ ...line, purchaseScopeLines: displayLines }, order)}
                                  >
                                    <Trash2 className="size-4" />
                                  </Button>
                                ) : null}
                              </div>
                            </TableCell>
                            ) : null}
                          </TableRow>
                        );
                      })}
                      <TableRow className="bg-muted/20 text-xs text-muted-foreground">
                        {showBulkPurchaseSelection && isPurchaseColumnVisible("select") ? <TableCell /> : null}
                        {isPurchaseColumnVisible("status") ? <TableCell className="font-medium text-foreground">합계</TableCell> : null}
                        {mode === "order" && isPurchaseColumnVisible("supplier") ? <TableCell /> : null}
                        {mode === "order" && isPurchaseColumnVisible("unitCost") ? <TableCell /> : null}
                        {isPurchaseColumnVisible("eventAt") ? <TableCell /> : null}
                        {isPurchaseColumnVisible("requester") ? <TableCell /> : null}
                        {isPurchaseColumnVisible("textbook") ? <TableCell /> : null}
                        {isPurchaseColumnVisible("location") ? <TableCell /> : null}
                        {isPurchaseColumnVisible("class") ? <TableCell /> : null}
                        {isPurchaseColumnVisible("studentRequested") ? <TableCell className={purchaseQuantityCellClassName("student")}>{formatQuantity(studentRequestedTotal)}</TableCell> : null}
                        {mode === "order" ? (
                          <>
                            {isPurchaseColumnVisible("studentOrdered") ? <TableCell className={purchaseQuantityCellClassName("student")}>{formatQuantity(studentOrderedTotal)}</TableCell> : null}
                            {isPurchaseColumnVisible("studentReceived") ? <TableCell className={purchaseQuantityCellClassName("student")}>{formatQuantity(studentReceivedTotal)}</TableCell> : null}
                          </>
                        ) : null}
                        {isPurchaseColumnVisible("teacherRequested") ? <TableCell className={purchaseQuantityCellClassName("teacher")}>{formatQuantity(teacherRequestedTotal)}</TableCell> : null}
                        {mode === "order" ? (
                          <>
                            {isPurchaseColumnVisible("teacherOrdered") ? <TableCell className={purchaseQuantityCellClassName("teacher")}>{formatQuantity(teacherOrderedTotal)}</TableCell> : null}
                            {isPurchaseColumnVisible("teacherReceived") ? <TableCell className={purchaseQuantityCellClassName("teacher")}>{formatQuantity(teacherReceivedTotal)}</TableCell> : null}
                          </>
                        ) : null}
                        {isPurchaseColumnVisible("decision") ? <TableCell /> : null}
                        {isPurchaseColumnVisible("action") ? <TableCell className={stickyActionCellClassName} /> : null}
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                </>
              ) : null}
              {!collapsed && rows.length === 0 ? (
                <ProcessGroupEmptyState
                  label={getPurchaseProcessEmptyLabel(mode, group.id, requestFilter, orderFilter, searchQuery)}
                  hint={getPurchaseProcessEmptyHint(mode, group.id, requestFilter, orderFilter, searchQuery)}
                  actionLabel={emptyActionLabel}
                  onAction={handleEmptyAction}
                />
              ) : null}
            </section>
          );
          })}
        </div>
      )}
      </div>
    </>
  );
}

function SalesHistoryLedger({
  sales,
  lines,
  textbooks,
  classes,
}: {
  sales: Row[];
  lines: Row[];
  textbooks: Row[];
  classes: Row[];
}) {
  const [yearFilter, setYearFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const rows = useMemo(
    () => buildSaleHistorySummaryRows({ sales, lines, textbooks, classes }),
    [sales, lines, textbooks, classes],
  );

  const yearOptions = useMemo(() => [...new Set(rows.map((row) => row.year).filter(Boolean))], [rows]);
  const monthOptions = useMemo(
    () => [...new Set(rows.filter((row) => yearFilter === "all" || row.year === yearFilter).map((row) => row.month))],
    [rows, yearFilter],
  );
  const classOptions = useMemo(() => {
    const options = new Map<string, string>();
    rows.forEach((row) => {
      if (row.classId) {
        options.set(row.classId, row.className);
      }
    });
    return [...options.entries()].sort((left, right) => left[1].localeCompare(right[1], "ko", { numeric: true }));
  }, [rows]);

  const effectiveMonthFilter = monthFilter !== "all" && monthOptions.includes(monthFilter) ? monthFilter : "all";

  const salesHistorySummary = useMemo(() => {
    const filteredRows: Array<(typeof rows)[number]> = [];
    let totalIssuedQuantity = 0;
    let totalWaitingQuantity = 0;
    for (const row of rows) {
      if (
        (yearFilter === "all" || row.year === yearFilter) &&
        (effectiveMonthFilter === "all" || row.month === effectiveMonthFilter) &&
        (classFilter === "all" || row.classId === classFilter)
      ) {
        filteredRows.push(row);
        totalIssuedQuantity += row.issuedQuantity;
        totalWaitingQuantity += row.waitingQuantity;
      }
    }
    return { filteredRows, totalIssuedQuantity, totalWaitingQuantity };
  }, [classFilter, effectiveMonthFilter, rows, yearFilter]);
  const { filteredRows, totalIssuedQuantity, totalWaitingQuantity } = salesHistorySummary;

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-background" aria-label="교재 출고 이력">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b p-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-medium">출고 이력</span>
          <Badge variant="secondary" className="rounded-md tabular-nums">{formatQuantity(filteredRows.length)}건</Badge>
          <Badge variant="outline" className="rounded-md tabular-nums">대기 {formatQuantity(totalWaitingQuantity)}</Badge>
          <Badge variant="outline" className="rounded-md tabular-nums">완료 {formatQuantity(totalIssuedQuantity)}</Badge>
        </div>
        <div className="grid w-full min-w-0 gap-2 sm:w-auto sm:grid-cols-3">
          <Select value={yearFilter} onValueChange={(value) => {
            setYearFilter(value);
            setMonthFilter("all");
          }}>
            <SelectTrigger className="h-8 w-full sm:w-[112px]" aria-label="출고 이력 연도">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 연도</SelectItem>
              {yearOptions.map((year) => (
                <SelectItem key={year} value={year}>{year}년</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={effectiveMonthFilter} onValueChange={setMonthFilter}>
            <SelectTrigger className="h-8 w-full sm:w-[112px]" aria-label="출고 이력 월">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 월</SelectItem>
              {monthOptions.map((month) => (
                <SelectItem key={month} value={month}>{month}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger className="h-8 w-full sm:w-[180px]" aria-label="출고 이력 수업">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 수업</SelectItem>
              {classOptions.map(([classId, className]) => (
                <SelectItem key={classId} value={classId}>{className}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="max-w-full overflow-x-auto">
        <Table className="min-w-[760px]">
          <caption className="sr-only">연도 월 수업별 교재 출고 이력</caption>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow className="bg-muted/30">
              <TableHead className="w-[96px]">월</TableHead>
              <TableHead className="w-[180px]">수업</TableHead>
              <TableHead>교재</TableHead>
              <TableHead className="w-[88px] text-right">대기</TableHead>
              <TableHead className="w-[88px] text-right">완료</TableHead>
              <TableHead className="w-[88px] text-right">합계</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="tabular-nums">{row.month}</TableCell>
                <TableCell className="max-w-[180px] truncate" title={row.className}>{row.className}</TableCell>
                <TableCell>
                  <div className="max-w-[360px] truncate font-medium" title={row.textbookTitle}>{row.textbookTitle}</div>
                  <div className="text-xs text-muted-foreground">{formatCompactDateTime(row.latestAt)}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatQuantity(row.waitingQuantity)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatQuantity(row.issuedQuantity)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatQuantity(row.totalQuantity)}</TableCell>
              </TableRow>
            ))}
            {filteredRows.length === 0 ? <EmptyRow colSpan={6} label="출고 이력이 없습니다" compact /> : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SalesProcessTable({
  sales,
  lines,
  textbooks,
  classes,
  students,
  locations,
  saving,
  statusFilter,
  searchQuery,
  selectedLineIds = [],
  canDeleteHistory = false,
  onStatusFilterChange,
  onAddSale,
  onUpdateStatus,
  onCancelLine,
  onReturnLine,
  onDeleteLine,
  onToggleLine,
  onToggleVisibleLines,
  onBulkIssue,
  onBulkCancel,
  onBulkReturn,
  onBulkDelete,
  onClearSearch,
}: {
  sales: Row[];
  lines: Row[];
  textbooks: Row[];
  classes: Row[];
  students: Row[];
  locations: Row[];
  saving: string;
  statusFilter: SalesProcessFilter;
  searchQuery: string;
  selectedLineIds?: string[];
  canDeleteHistory?: boolean;
  onStatusFilterChange: (filter: SalesProcessFilter) => void;
  onAddSale: () => void;
  onUpdateStatus: (line: Row, status: "issued" | "returned") => void;
  onCancelLine: (line: Row) => void;
  onReturnLine: (line: Row) => void;
  onDeleteLine?: (line: Row) => void;
  onToggleLine?: (lineId: string, checked: boolean) => void;
  onToggleVisibleLines?: (lineIds: string[], checked: boolean) => void;
  onBulkIssue?: () => void;
  onBulkCancel?: () => void;
  onBulkReturn?: () => void;
  onBulkDelete?: () => void;
  onClearSearch: () => void;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [billingDialogOpen, setBillingDialogOpen] = useState(false);
  const salesById = useMemo(() => new Map(sales.map((sale) => [getRecordId(sale), sale])), [sales]);
  const studentsById = useMemo(() => new Map(students.map((student) => [getRecordId(student), student])), [students]);
  const grouped = useMemo(() => groupSaleLinesByStatus({ lines }) as Record<string, Row[]>, [lines]);
  const selectedLineIdSet = useMemo(() => new Set(selectedLineIds), [selectedLineIds]);
  const groups = useMemo(() => [
    { id: "charged", title: "출고 대기" },
    { id: "issued", title: "출고 완료" },
    { id: "cancelled", title: "취소" },
    { id: "returned", title: "반품" },
  ], []);
  const visibleGroups = useMemo(() => (
    statusFilter === "waiting" ? groups.filter((group) => group.id === "charged") :
    statusFilter === "issued" ? groups.filter((group) => group.id === "issued") :
    statusFilter === "returned" ? groups.filter((group) => group.id === "returned") :
    statusFilter === "cancelled" ? groups.filter((group) => group.id === "cancelled") :
    groups
  ), [groups, statusFilter]);
  const salesFilterOptions = useMemo(
    () => [
      { value: "all", label: "전체 출고" },
      { value: "waiting", label: "출고 대기" },
      { value: "issued", label: "출고 완료" },
      { value: "returned", label: "반품" },
      { value: "cancelled", label: "취소" },
    ] satisfies Array<{ value: SalesProcessFilter; label: string }>,
    [],
  );

  function toggleGroup(id: string) {
    setCollapsedGroups((current) => ({ ...current, [id]: !current[id] }));
  }

  function collapseAllGroups() {
    setCollapsedGroups(Object.fromEntries(visibleGroups.map((group) => [group.id, true])));
  }

  function expandAllGroups() {
    setCollapsedGroups({});
  }

  const searchMatchedSaleRowsByGroup = useMemo(() => {
    const rowsByGroup = new Map<string, Row[]>();
    for (const group of groups) {
      rowsByGroup.set(group.id, (grouped[group.id] || []).filter((line) => {
        const sale = salesById.get(text(line.sale_id || line.saleId));
        if (!shouldShowOperationalSaleLine(line, textbooks)) {
          return false;
        }
        return matchesSaleLineQuery({ line, sale, query: searchQuery, textbooks, classes, locations, students });
      }));
    }
    return rowsByGroup;
  }, [classes, grouped, groups, locations, salesById, searchQuery, students, textbooks]);

  const getVisibleSaleRows = useCallback((groupId: string) => {
    return searchMatchedSaleRowsByGroup.get(groupId) || [];
  }, [searchMatchedSaleRowsByGroup]);

  const visibleSaleRowsByGroup = useMemo(() => {
    const rowsByGroup = new Map<string, Row[]>();
    for (const group of visibleGroups) {
      rowsByGroup.set(group.id, getVisibleSaleRows(group.id));
    }
    return rowsByGroup;
  }, [getVisibleSaleRows, visibleGroups]);
  const getCurrentVisibleSaleRows = useCallback(
    (groupId: string) => visibleSaleRowsByGroup.get(groupId) || [],
    [visibleSaleRowsByGroup],
  );
  const visibleSaleRowsWithGroup = useMemo(
    () => visibleGroups.flatMap((group) =>
      getCurrentVisibleSaleRows(group.id).map((line) => ({ line, groupId: group.id })),
    ),
    [getCurrentVisibleSaleRows, visibleGroups],
  );
  const visibleSaleRows = useMemo(
    () => visibleSaleRowsWithGroup.map((item) => item.line),
    [visibleSaleRowsWithGroup],
  );

  const visibleRowCount = visibleSaleRows.length;
  const visibleTotalQuantity = visibleSaleRows.reduce(
    (sum, line) => sum + getSaleLineQuantity(line),
    0,
  );
  const visibleStudentCount = new Set(
    visibleSaleRows.map((line) => text(line.student_id || line.studentId)).filter(Boolean),
  ).size;
  const visibleClassCount = new Set(
    visibleSaleRows.map((line) => {
      const sale = salesById.get(text(line.sale_id || line.saleId));
      return text(line.class_id || line.classId || sale?.class_id || sale?.classId);
    }).filter(Boolean),
  ).size;
  const visibleTotalAmount = visibleSaleRows.reduce((sum, line) => {
    const sale = salesById.get(text(line.sale_id || line.saleId));
    if (!isBillableSaleLineStatus(getSaleLineStatus(line, sale))) return sum;
    const textbook = getTextbookById(textbooks, text(line.textbook_id || line.textbookId));
    return sum + getSaleLineAmount(line, textbook);
  }, 0);
  const saleProcessActionIds = useMemo(() => {
    const issuable: string[] = [];
    const cancelable: string[] = [];
    const returnable: string[] = [];
    const deletable: string[] = [];

    for (const { line, groupId } of visibleSaleRowsWithGroup) {
      const lineId = getRecordId(line);
      if (!lineId) {
        continue;
      }
      const status = text(line.status) || groupId;
      const isOpen = status !== "issued" && status !== "cancelled" && status !== "returned";
      if (isOpen) {
        issuable.push(lineId);
        cancelable.push(lineId);
      }
      if (status === "issued") {
        returnable.push(lineId);
      }
      if (canDeleteHistory) {
        deletable.push(lineId);
      }
    }
    return { issuable, cancelable, returnable, deletable };
  }, [canDeleteHistory, visibleSaleRowsWithGroup]);
  const visibleIssuableLineIds = saleProcessActionIds.issuable;
  const visibleCancelableLineIds = saleProcessActionIds.cancelable;
  const visibleReturnableLineIds = saleProcessActionIds.returnable;
  const visibleDeletableLineIds = saleProcessActionIds.deletable;
  const selectedIssuableCount = useMemo(
    () => visibleIssuableLineIds.filter((id) => selectedLineIdSet.has(id)).length,
    [selectedLineIdSet, visibleIssuableLineIds],
  );
  const selectedCancelableCount = useMemo(
    () => visibleCancelableLineIds.filter((id) => selectedLineIdSet.has(id)).length,
    [selectedLineIdSet, visibleCancelableLineIds],
  );
  const selectedReturnableCount = useMemo(
    () => visibleReturnableLineIds.filter((id) => selectedLineIdSet.has(id)).length,
    [selectedLineIdSet, visibleReturnableLineIds],
  );
  const selectedDeletableCount = useMemo(
    () => visibleDeletableLineIds.filter((id) => selectedLineIdSet.has(id)).length,
    [selectedLineIdSet, visibleDeletableLineIds],
  );
  const visibleActionableLineIds = useMemo(
    () => [...new Set([...visibleIssuableLineIds, ...visibleCancelableLineIds, ...visibleReturnableLineIds])],
    [visibleCancelableLineIds, visibleIssuableLineIds, visibleReturnableLineIds],
  );
  const visibleActionableLineIdSet = useMemo(
    () => new Set(visibleActionableLineIds),
    [visibleActionableLineIds],
  );
  const visibleSelectableSaleLineIdSet = useMemo(
    () => canDeleteHistory ? new Set(visibleDeletableLineIds) : visibleActionableLineIdSet,
    [canDeleteHistory, visibleActionableLineIdSet, visibleDeletableLineIds],
  );
  const selectedActionableCount = useMemo(
    () => canDeleteHistory
      ? selectedDeletableCount
      : visibleActionableLineIds.filter((id) => selectedLineIdSet.has(id)).length,
    [canDeleteHistory, selectedDeletableCount, selectedLineIdSet, visibleActionableLineIds],
  );
  const renderedGroups = visibleGroups.filter((group) => getCurrentVisibleSaleRows(group.id).length > 0);
  const emptyGroupId = visibleGroups[0]?.id || "charged";
  const salesProcessFilterCounts = useMemo(() => {
    const counts = Object.fromEntries(salesProcessFilterValues.map((filter) => [filter, 0])) as Record<SalesProcessFilter, number>;
    for (const group of groups) {
      const rowCount = getVisibleSaleRows(group.id).length;
      counts.all += rowCount;
      if (group.id === "charged") counts.waiting += rowCount;
      if (group.id === "issued") counts.issued += rowCount;
      if (group.id === "returned") counts.returned += rowCount;
      if (group.id === "cancelled") counts.cancelled += rowCount;
    }
    return counts;
  }, [getVisibleSaleRows, groups]);
  const hasProcessSearchQuery = Boolean(text(searchQuery));
  const totalSalesRowCount = lines.length;
  const showSalesControls = totalSalesRowCount > 0 || hasProcessSearchQuery;
  const showSalesGroupToggleControls = renderedGroups.length > 1;
  const makeEduBillingGroups = useMemo(() => buildMakeEduBillingHandoffGroups({
    rows: visibleSaleRows,
    salesById,
    textbooks,
    classes,
    studentsById,
  }), [classes, salesById, studentsById, textbooks, visibleSaleRows]);
  const makeEduBillingTotalAmount = makeEduBillingGroups.reduce((sum, group) => sum + group.totalAmount, 0);
  const emptyActionLabel = hasProcessSearchQuery ? "검색 초기화" : "출고 바로 추가";
  const emptyAction = hasProcessSearchQuery ? onClearSearch : onAddSale;

  return (
    <>
      <TextbookHandoffDialog
        open={billingDialogOpen}
        onOpenChange={setBillingDialogOpen}
        title="메이크에듀 청구 준비"
        description="보이는 출고 건을 메이크에듀 기타수납 생성용 수납명, 금액, 대상 원생으로 정리합니다."
        groups={makeEduBillingGroups}
        emptyLabel="청구할 출고 건이 없습니다"
        idPrefix="makeedu-billing"
      />
      <div className="min-w-0 overflow-hidden rounded-lg border bg-background max-w-[calc(100vw-2rem)] md:max-w-none" aria-label="교재 출고 목록">
      {showSalesControls ? (
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b p-3">
        <div className="flex flex-wrap gap-1">
          {salesFilterOptions.map((option) => (
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
                {formatQuantity(salesProcessFilterCounts[option.value as SalesProcessFilter])}
              </span>
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Badge variant="secondary" className="h-8 rounded-md px-2 tabular-nums">
            표시 {formatQuantity(visibleRowCount)}건
          </Badge>
          <Badge variant="outline" className="h-8 rounded-md px-2 tabular-nums">
            수량 {formatQuantity(visibleTotalQuantity)}
          </Badge>
          <Badge variant="outline" className="h-8 rounded-md px-2 tabular-nums">
            수업 {formatQuantity(visibleClassCount)}
          </Badge>
          <Badge variant="outline" className="h-8 rounded-md px-2 tabular-nums">
            학생 {formatQuantity(visibleStudentCount)}
          </Badge>
          <Badge variant="outline" className="h-8 rounded-md px-2 tabular-nums">
            청구 {formatCurrency(visibleTotalAmount)}
          </Badge>
          {selectedActionableCount > 0 ? (
            <>
              <Badge variant="secondary" className="h-8 rounded-md px-2 tabular-nums">
                선택 {formatQuantity(selectedActionableCount)}
              </Badge>
              {selectedIssuableCount > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  aria-label="선택 출고 일괄 완료"
                  title="선택 출고 일괄 완료"
                  onClick={onBulkIssue}
                >
                  선택 출고
                </Button>
              ) : null}
              {selectedCancelableCount > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  aria-label="선택 출고 전 취소"
                  title="선택 출고 전 취소"
                  onClick={onBulkCancel}
                >
                  선택 취소
                </Button>
              ) : null}
              {selectedReturnableCount > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  aria-label="선택 고객 반품"
                  title="선택 고객 반품"
                  onClick={onBulkReturn}
                >
                  선택 반품
                </Button>
              ) : null}
              {canDeleteHistory && selectedDeletableCount > 0 && onBulkDelete ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  aria-label="선택 출고 이력 삭제"
                  title="선택 출고 이력 삭제"
                  onClick={onBulkDelete}
                >
                  선택 삭제
                </Button>
              ) : null}
            </>
          ) : null}
          {visibleRowCount > 0 && showSalesGroupToggleControls ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0"
                aria-label="출고 그룹 전체 접기"
                title="출고 그룹 전체 접기"
                onClick={collapseAllGroups}
              >
                전체 접기
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0"
                aria-label="출고 그룹 전체 펼치기"
                title="출고 그룹 전체 펼치기"
                onClick={expandAllGroups}
              >
                전체 펼치기
              </Button>
            </>
          ) : null}
          {visibleRowCount > 0 ? (
            <>
              {makeEduBillingGroups.length > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  aria-label="메이크에듀 청구 준비 열기"
                  title="메이크에듀 청구 준비"
                  onClick={() => setBillingDialogOpen(true)}
                >
                  <Copy className="mr-2 size-3.5" />
                  청구 {formatQuantity(makeEduBillingGroups.length)}건 · {formatCurrency(makeEduBillingTotalAmount)}
                </Button>
              ) : null}
              <Button type="button" size="sm" className="shrink-0" aria-label="교재 출고 추가" title="교재 출고 추가" onClick={onAddSale}>
                <Plus className="mr-2 size-4" />
                출고 추가
              </Button>
            </>
          ) : null}
        </div>
      </div>
      ) : null}

      {visibleRowCount === 0 ? (
        <ProcessGroupEmptyState
          label={getSalesProcessEmptyLabel(emptyGroupId, statusFilter, searchQuery)}
          hint={showSalesControls ? getSalesProcessEmptyHint(emptyGroupId, statusFilter, searchQuery) : undefined}
          actionLabel={emptyActionLabel}
          onAction={emptyAction}
        />
      ) : (
        <div className="grid gap-0">
          {renderedGroups.map((group) => {
          const rows = getCurrentVisibleSaleRows(group.id);
          const collapsed = Boolean(collapsedGroups[group.id]);
          const totalCount = rows.length;
          const totalQuantity = rows.reduce((sum, line) => sum + (numberValue(line.quantity) || 1), 0);
          const groupSelectableLineIds: string[] = [];
          for (const line of rows) {
            const lineId = getRecordId(line);
            if (lineId && visibleSelectableSaleLineIdSet.has(lineId)) {
              groupSelectableLineIds.push(lineId);
            }
          }
          const groupSelectedSelectableCount = groupSelectableLineIds.filter((id) => selectedLineIdSet.has(id)).length;
          const groupAllSelectableSelected =
            groupSelectableLineIds.length > 0 && groupSelectedSelectableCount === groupSelectableLineIds.length;
          const groupSomeSelectableSelected =
            groupSelectedSelectableCount > 0 && !groupAllSelectableSelected;

          return (
            <section key={group.id} className="min-w-0 overflow-hidden border-b last:border-b-0">
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
                <Badge variant="secondary" className="rounded-md tabular-nums">{formatQuantity(totalCount)}</Badge>
                <Badge variant="outline" className="ml-auto rounded-md bg-background tabular-nums">
                  수량 {formatQuantity(totalQuantity)}
                </Badge>
              </button>
              {!collapsed && totalCount > 0 ? (
                <>
                <div data-testid="textbook-sales-process-mobile-list" className="grid min-w-0 max-w-full gap-2 overflow-hidden p-2 md:hidden">
                  {rows.map((line) => {
                    const lineId = getRecordId(line);
                    const sale = salesById.get(text(line.sale_id || line.saleId));
                    const textbook = getTextbookById(textbooks, text(line.textbook_id || line.textbookId));
                    const classItem = getClassById(classes, text(line.class_id || sale?.class_id));
                    const rawStatus = text(line.status || sale?.status) || group.id;
                    const status = rawStatus === "paid" ? "charged" : rawStatus;
                    const quantity = numberValue(line.quantity) || 1;
                    const textbookTitle = textbook ? getTextbookTitle(textbook) : text(line.textbook_id);
                    const copyScope = getTextbookCopyScope(line);
                    const studentName = getSaleLineRecipientName(line, studentsById);
                    const locationName = getLocationName(locations, text(line.location_id || line.locationId || sale?.location_id || sale?.locationId)) || "-";
                    const isTerminalSaleStatus = status === "issued" || status === "cancelled" || status === "returned";
                    const canDeleteThisLine = canDeleteHistory && Boolean(onDeleteLine);
                    const canSelectThisLine = canDeleteHistory || !isTerminalSaleStatus;

                    return (
                      <article key={`mobile-${lineId}`} className="min-w-0 rounded-md border bg-background p-3 shadow-xs">
                        <div className="flex min-w-0 items-start gap-3">
                          <Checkbox
                            checked={selectedLineIdSet.has(lineId)}
                            disabled={!canSelectThisLine}
                            onCheckedChange={(value) => onToggleLine?.(lineId, value === true)}
                            title={`${studentName} ${textbookTitle} 출고 선택`}
                            aria-label={`${studentName} ${textbookTitle} 출고 선택`}
                            className="mt-1 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold" title={textbookTitle}>{textbookTitle}</div>
                                <div className="mt-0.5 truncate text-xs text-muted-foreground">{studentName} · {getTextbookCopyScopeLabel(copyScope)}</div>
                              </div>
                              <Badge variant="outline" className={cn("shrink-0 rounded-md", processStatusPillClass(status))}>
                                {saleStatusLabels[status] || status}
                              </Badge>
                            </div>
                            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                              <div className="rounded-md bg-muted/50 px-2 py-2">
                                <div className="text-muted-foreground">출고월</div>
                                <div className="mt-1 font-medium tabular-nums">{text(line.charge_month || sale?.charge_month) || "-"}</div>
                              </div>
                              <div className="rounded-md bg-muted/50 px-2 py-2">
                                <div className="text-muted-foreground">위치</div>
                                <div className="mt-1 truncate font-medium">{locationName}</div>
                              </div>
                              <div className="rounded-md bg-muted/50 px-2 py-2">
                                <div className="text-muted-foreground">수량</div>
                                <div className="mt-1 font-mono font-semibold">{formatQuantity(quantity)}</div>
                              </div>
                            </div>
                            <div className="mt-2 truncate text-xs text-muted-foreground" title={classItem ? getClassName(classItem) : "-"}>
                              {classItem ? getClassName(classItem) : "-"} · {formatCompactDateTime(getSaleEventAt(line, sale, status))}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 grid min-w-0 grid-cols-2 gap-2 [&>button]:w-full">
                          {status !== "issued" && status !== "cancelled" && status !== "returned" ? (
                            <>
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
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-label={`${studentName} ${textbookTitle} 출고 전 취소`}
                                disabled={saving === `sale-delete-${lineId}`}
                                onClick={() => onCancelLine(line)}
                              >
                                취소
                              </Button>
                            </>
                          ) : status === "issued" ? (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-label={`${studentName} ${textbookTitle} 고객 반품`}
                                disabled={saving === `sale-line-${lineId}`}
                                onClick={() => onReturnLine(line)}
                              >
                                반품
                              </Button>
                              {canDeleteThisLine ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  aria-label={`${studentName} ${textbookTitle} 출고 이력 삭제`}
                                  disabled={saving === `sale-delete-${lineId}`}
                                  onClick={() => onDeleteLine?.(line)}
                                >
                                  삭제
                                </Button>
                              ) : null}
                            </>
                          ) : canDeleteThisLine ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              aria-label={`${studentName} ${textbookTitle} 출고 이력 삭제`}
                              disabled={saving === `sale-delete-${lineId}`}
                              onClick={() => onDeleteLine?.(line)}
                            >
                              삭제
                            </Button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
                <div className="hidden max-w-full overflow-x-auto md:block">
                  <Table className="w-full min-w-[980px]">
                    <caption className="sr-only">교재 출고 처리 목록</caption>
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow className="bg-muted/30">
                        <TableHead className="w-10">
                          <Checkbox
                            checked={groupAllSelectableSelected || (groupSomeSelectableSelected && "indeterminate")}
                            disabled={groupSelectableLineIds.length === 0}
                            onCheckedChange={(value) => onToggleVisibleLines?.(groupSelectableLineIds, value === true)}
                            title={canDeleteHistory ? "표시된 출고 이력 전체 선택" : "출고 대기 전체 선택"}
                            aria-label={canDeleteHistory ? "표시된 출고 이력 전체 선택" : "출고 대기 전체 선택"}
                          />
                        </TableHead>
                        <TableHead className="w-[112px]">진행상태</TableHead>
                        <TableHead className="w-[96px]">출고월</TableHead>
                        <TableHead className="w-[132px]">대상</TableHead>
                        <TableHead className="w-[150px]">수업</TableHead>
                        <TableHead>교재명</TableHead>
                        <TableHead className="w-[88px]">위치</TableHead>
                        <TableHead className="w-[72px] text-right">수량</TableHead>
                        <TableHead className={cn("w-[120px] text-right", stickyActionHeadClassName)}>작업</TableHead>
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
                        const copyScope = getTextbookCopyScope(line);
                        const studentName = getSaleLineRecipientName(line, studentsById);
                        const locationName = getLocationName(locations, text(line.location_id || line.locationId || sale?.location_id || sale?.locationId)) || "-";
                        const isTerminalSaleStatus = status === "issued" || status === "cancelled" || status === "returned";
                        const canDeleteThisLine = canDeleteHistory && Boolean(onDeleteLine);
                        const canSelectThisLine = canDeleteHistory || !isTerminalSaleStatus;

                        return (
                          <TableRow key={lineId}>
                            <TableCell>
                              <Checkbox
                                checked={selectedLineIdSet.has(lineId)}
                                disabled={!canSelectThisLine}
                                onCheckedChange={(value) => onToggleLine?.(lineId, value === true)}
                                title={`${studentName} ${textbookTitle} 출고 선택`}
                                aria-label={`${studentName} ${textbookTitle} 출고 선택`}
                              />
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={cn("rounded-md", processStatusPillClass(status))}>
                                {saleStatusLabels[status] || status}
                              </Badge>
                            </TableCell>
                            <TableCell className="tabular-nums">{text(line.charge_month || sale?.charge_month) || "-"}</TableCell>
                            <TableCell className="max-w-[132px]" title={studentName}>
                              <div className="min-w-0 truncate">{studentName}</div>
                              <div className="text-xs text-muted-foreground">{getTextbookCopyScopeLabel(copyScope)}</div>
                            </TableCell>
                            <TableCell className="max-w-[150px] truncate" title={classItem ? getClassName(classItem) : "-"}>{classItem ? getClassName(classItem) : "-"}</TableCell>
                            <TableCell>
                              <div className="max-w-[360px] truncate font-medium" title={textbookTitle}>{textbookTitle}</div>
                              <div className="text-xs text-muted-foreground">{formatCompactDateTime(getSaleEventAt(line, sale, status))}</div>
                            </TableCell>
                            <TableCell className="max-w-[88px] truncate" title={locationName}>{locationName}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatQuantity(quantity)}</TableCell>
                            <TableCell className={stickyActionCellClassName}>
                              <div className="flex justify-end gap-1">
                                {status !== "issued" && status !== "cancelled" && status !== "returned" ? (
                                  <>
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
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      aria-label={`${studentName} ${textbookTitle} 출고 전 취소`}
                                      disabled={saving === `sale-delete-${lineId}`}
                                      onClick={() => onCancelLine(line)}
                                    >
                                      취소
                                    </Button>
                                  </>
                                ) : status === "issued" ? (
                                  <>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      aria-label={`${studentName} ${textbookTitle} 고객 반품`}
                                      disabled={saving === `sale-line-${lineId}`}
                                      onClick={() => onReturnLine(line)}
                                    >
                                      반품
                                    </Button>
                                    {canDeleteThisLine ? (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                        aria-label={`${studentName} ${textbookTitle} 출고 이력 삭제`}
                                        disabled={saving === `sale-delete-${lineId}`}
                                        onClick={() => onDeleteLine?.(line)}
                                      >
                                        삭제
                                      </Button>
                                    ) : null}
                                  </>
                                ) : canDeleteThisLine ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    aria-label={`${studentName} ${textbookTitle} 출고 이력 삭제`}
                                    disabled={saving === `sale-delete-${lineId}`}
                                    onClick={() => onDeleteLine?.(line)}
                                  >
                                    삭제
                                  </Button>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="bg-muted/20 text-xs text-muted-foreground">
                        <TableCell colSpan={7} className="text-right">합계</TableCell>
                        <TableCell className="text-right tabular-nums">{formatQuantity(totalQuantity)}</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                </>
              ) : null}
              {!collapsed && totalCount === 0 ? (
                <ProcessGroupEmptyState
                  label={getSalesProcessEmptyLabel(group.id, statusFilter, searchQuery)}
                  hint={getSalesProcessEmptyHint(group.id, statusFilter, searchQuery)}
                  actionLabel={emptyActionLabel}
                  onAction={emptyAction}
                />
              ) : null}
            </section>
          );
          })}
        </div>
      )}
      </div>
    </>
  );
}

function MonthlyClosingTable({
  rows,
  selectedIds = [],
  saving = "",
  onToggleRow,
  onToggleVisibleRows,
  onBulkLock,
  onInspectRow,
}: {
  rows: Row[];
  selectedIds?: string[];
  saving?: string;
  onToggleRow?: (id: string, checked: boolean) => void;
  onToggleVisibleRows?: (ids: string[], checked: boolean) => void;
  onBulkLock?: () => void;
  onInspectRow?: (row: Row) => void;
}) {
  const recentRows = useMemo(() => [...rows].slice(-12).reverse(), [rows]);
  const visibleIds = useMemo(() => recentRows.map(getRecordId).filter(Boolean), [recentRows]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedVisibleCount = visibleIds.filter((id) => selectedIdSet.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
  return (
    <div className="overflow-hidden rounded-lg border" aria-label="월마감 정산 이력">
      {selectedVisibleCount > 0 ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-b bg-muted/20 p-2">
          <Badge variant="secondary" className="h-8 rounded-md px-2 tabular-nums">
            선택 {formatQuantity(selectedVisibleCount)}
          </Badge>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={saving === "closing-bulk-lock"}
            aria-label="선택 정산 확정"
            title="선택 정산 확정"
            onClick={onBulkLock}
          >
            선택 확정
          </Button>
        </div>
      ) : null}
      <div data-testid="textbook-closing-mobile-list" className="grid min-w-0 max-w-full gap-2 overflow-hidden p-2 md:hidden">
        {recentRows.length > 0 ? (
          <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <div className="flex min-w-0 items-center gap-2">
              <Checkbox
                checked={allVisibleSelected || (someVisibleSelected && "indeterminate")}
                onCheckedChange={(value) => onToggleVisibleRows?.(visibleIds, value === true)}
                title="정산 행 전체 선택"
                aria-label="정산 행 전체 선택"
                className="shrink-0"
              />
              <span className="truncate">최근 {formatQuantity(visibleIds.length)}건</span>
            </div>
            <span className="shrink-0 tabular-nums">선택 {formatQuantity(selectedVisibleCount)}</span>
          </div>
        ) : null}
        {recentRows.map((row) => {
          const rowId = getRecordId(row);
          const subjectLabel = text(row.subject) === "all" ? "전체" : getSubjectLabel(row.subject);
          const closingA11yLabel = `${text(row.closing_month)} ${subjectLabel}`;

          return (
            <article key={`mobile-${rowId || closingA11yLabel}`} className="min-w-0 rounded-md border bg-background p-3 shadow-xs">
              <div className="flex min-w-0 items-start gap-3">
                <Checkbox
                  checked={selectedIdSet.has(rowId)}
                  disabled={!rowId}
                  onCheckedChange={(value) => onToggleRow?.(rowId, value === true)}
                  title={`${closingA11yLabel} 정산 선택`}
                  aria-label={`${closingA11yLabel} 정산 선택`}
                  className="mt-1 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-sm font-semibold tabular-nums underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      aria-label={`${closingA11yLabel} 정산 상세 열기`}
                      title={`${closingA11yLabel} 정산 상세`}
                      onClick={() => onInspectRow?.(row)}
                    >
                      {text(row.closing_month)} · {subjectLabel}
                    </button>
                    <Badge variant="outline" className="shrink-0 rounded-md">
                      {text(row.status) || "대기"}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
                <div className="rounded-md bg-muted/50 px-2 py-2">
                  <div className="text-muted-foreground">입고</div>
                  <div className="mt-1 font-medium tabular-nums">{formatQuantity(row.purchase_quantity)}</div>
                </div>
                <div className="rounded-md bg-muted/50 px-2 py-2">
                  <div className="text-muted-foreground">출고</div>
                  <div className="mt-1 font-medium tabular-nums">{formatQuantity(row.sale_quantity)}</div>
                </div>
                <div className="rounded-md bg-muted/50 px-2 py-2">
                  <div className="text-muted-foreground">기말</div>
                  <div className="mt-1 font-medium tabular-nums">{formatQuantity(row.ending_quantity)}</div>
                </div>
                <div className="rounded-md bg-muted/50 px-2 py-2">
                  <div className="text-muted-foreground">마진</div>
                  <div className="mt-1 font-medium tabular-nums">{formatCurrency(row.settlement_difference)}</div>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`${closingA11yLabel} 정산 상세 열기`}
                  title={`${closingA11yLabel} 정산 상세`}
                  onClick={() => onInspectRow?.(row)}
                >
                  상세
                </Button>
              </div>
            </article>
          );
        })}
        {recentRows.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">마감 이력이 없습니다</div>
        ) : null}
      </div>
      <div className="hidden max-w-full overflow-x-auto md:block">
      <Table className="min-w-[760px]">
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allVisibleSelected || (someVisibleSelected && "indeterminate")}
                onCheckedChange={(value) => onToggleVisibleRows?.(visibleIds, value === true)}
                title="정산 행 전체 선택"
                aria-label="정산 행 전체 선택"
              />
            </TableHead>
            <TableHead>월</TableHead>
            <TableHead>과목</TableHead>
            <TableHead className="text-right">입고</TableHead>
            <TableHead className="text-right">출고</TableHead>
            <TableHead className="text-right">기말</TableHead>
            <TableHead className="text-right">마진</TableHead>
            <TableHead>상태</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recentRows.map((row) => (
            <TableRow
              key={getRecordId(row)}
              className="cursor-pointer"
              tabIndex={0}
              onClick={() => onInspectRow?.(row)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onInspectRow?.(row);
                }
              }}
            >
              <TableCell onClick={(event) => event.stopPropagation()}>
                <Checkbox
                  checked={selectedIdSet.has(getRecordId(row))}
                  onCheckedChange={(value) => onToggleRow?.(getRecordId(row), value === true)}
                  title={`${text(row.closing_month)} 정산 선택`}
                  aria-label={`${text(row.closing_month)} 정산 선택`}
                />
              </TableCell>
              <TableCell className="tabular-nums">{text(row.closing_month)}</TableCell>
              <TableCell>{text(row.subject) === "all" ? "전체" : getSubjectLabel(row.subject)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatQuantity(row.purchase_quantity)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatQuantity(row.sale_quantity)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatQuantity(row.ending_quantity)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCurrency(row.settlement_difference)}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="rounded-md">{text(row.status) || "대기"}</Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-md px-2 text-xs"
                    aria-label={`${text(row.closing_month)} ${text(row.subject) === "all" ? "전체" : getSubjectLabel(row.subject)} 정산 상세 열기`}
                    title={`${text(row.closing_month)} ${text(row.subject) === "all" ? "전체" : getSubjectLabel(row.subject)} 정산 상세`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onInspectRow?.(row);
                    }}
                  >
                    상세
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {recentRows.length === 0 ? <EmptyRow colSpan={8} label="마감 이력이 없습니다" /> : null}
        </TableBody>
      </Table>
      </div>
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
