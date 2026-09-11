"use client";
import { compactUniqueLabels, buildTextbookCleanupPreviewRows, getTeacherName, doesSearchOptionMatchFilters, buildSearchSelectCommandValue, buildSearchSelectFilterGroups, buildVisibleSearchSelectFilterGroups, buildTextbookReferenceOptions, buildTextbookClassReferenceOptions } from "./textbook-reference-model";
import { saleStatusLabels, TEXTBOOK_HANDOFF_BUSINESS_NAME, getKnownPublisherLabel, normalizeMonthInput, formatCurrency, getTextbookHandoffDocumentMeta, formatPurchaseUnitCost, getStudentGradeLabel, getSupplierName, getConfiguredSupplierIdForTextbook, getConfiguredTextbookPurchaseUnitCost, getSaleLineRecipientName, purchaseStatusLabel } from "./textbook-handoff-model";
import type { TextbookHandoffLine, TextbookHandoffGroup } from "./textbook-handoff-model";

import { Fragment, FormEvent, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type SetStateAction } from "react";
import { useSearchParams } from "next/navigation";
import { useDraftNavigation } from "@/hooks/use-draft-navigation";
import { pushLocalHistoryState } from "@/lib/unsaved-history-fallback";
import {
  Barcode,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  FileImage,
  Loader2,
  PackageCheck,
  Plus,
  Pencil,
  Printer,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Truck,
  X,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { ActionFeedback } from "@/components/ui/action-feedback";
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
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { FormDialogContent, DetailDialogContent, DocumentDialogContent, ConfirmationDialogContent } from "@/components/ui/form-dialog";
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
import { DataTableSearchField } from "@/components/data-table/data-table-search-field";
import { DataTableSelectFilter } from "@/components/data-table/data-table-select-filter";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import {
  DATA_TABLE_LAYOUT_CLASS_NAME, DATA_TABLE_PAGER_CLASS_NAME,
  DATA_TABLE_MOBILE_LIST_CLASS_NAME, DATA_TABLE_MOBILE_ITEM_CLASS_NAME, DataTableToolbar, DataTableWorkspaceToolbar, DataTableFilters, DataTableViewport,
  DataTableHeaderCell, DataTableHeaderRow, DataTableBodyCell, DataTableBodyRow, DataTableReadFeedback,
} from "@/components/data-table/data-table-surface";
import { DataTableSelectionCheckbox } from "@/components/data-table/data-table-selection";
import { DataTableDetailButton, DataTableRowActions } from "@/components/data-table/data-table-row-actions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { captureElementAsPdfBlob, captureElementAsPngBlob, downloadBlob } from "@/lib/export-as-image";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { useTextbookNumberedData } from "./use-textbook-numbered-data";
import { useTextbookReferenceData, type TextbookReferencePickerState } from "./use-textbook-reference-data";
import { parseTextbookNavigation, serializeTextbookNavigation, type TextbookNavigationState, type TextbookTab } from "./textbook-navigation";

import {
  buildTeacherTextbookIssueDraft,
  buildTextbookSaleDraft,
  getRecordId,
  getTextbookCopyScope,
  getTextbookSalePrice,
  getTextbookActionErrorMessage,
  getTextbookTitle,
  groupPurchaseLinesByStatus,
  groupSaleLinesByStatus,
  normalizeBarcodeValue,
} from "./textbook-ledger.js";
import { textbookService } from "./textbook-service";
import { getTextbookInventoryBalance, getTextbookPurchaseDetail, getTextbookSaleDetail } from "./textbook-read-service";
import { getTextbookInactiveCleanupContext } from "./textbook-reference-service";
import { getClassTextbookSaleContext, getTextbookBillingHandoff, getTextbookPurchaseHandoff } from "./textbook-work-context-service";
import {
  subjectOptions,
  text,
  textPreservingZero,
  getRowFieldText,
  getSubjectLabel,
  getPublisherLabel,
  normalizeStatusValue,
  numberValue,
  formatQuantity,
  currentMonth,
  getClassName,
  getLocationName,
  getTextbookById,
  getRequestedTextbookTitle,
  getPurchaseTextbookTitle,
  getPurchaseLineOrder,
  getClassById,
  getSaleEventAt,
  buildPurchaseCardDraft,
  getPurchaseScopeLines,
  buildPurchaseDisplayRows,
} from "./textbook-read-model";
import type {
  SearchSelectOption,
  SearchSelectFilterLayout,
  SearchSelectFilterGroup,
  Row,
  PurchaseBoardScope,
  PurchaseRequestFilter,
  PurchaseOrderFilter,
  SalesProcessFilter,
  PurchaseKanbanStatus,
  TextbookCopyScope,
  PurchaseQuantityKind,
  PurchaseKanbanDraft,
  InventoryCountRow,
  InventoryHistoryRow,
  TextbookMasterSummary,
  TextbookInventorySummary,
  TextbookInventoryHistoryTransport,
  TextbookPurchaseCaseRow,
  TextbookPurchaseSummary,
  SaleLineRow,
  TextbookSaleSummary,
  PurchaseFilters,
  SaleFilters,
} from "./textbook-read-types";
import {
  SCIENCE_TEXTBOOK_TAXONOMY,
  TEXTBOOK_GRADE_OPTIONS,
  TEXTBOOK_SCHOOL_LEVEL_OPTIONS,
  TEXTBOOK_SCIENCE_AREA_OPTIONS,
  TextbookGradeLevel,
  TextbookSchoolLevel,
  TextbookSubSubjectSettingRecord,
  getGradeOptionsForSchoolLevel,
  getSubSubjectOptionsForSubject,
  getTextbookCategoryLabel,
  getTextbookGradeSummary,
  getTextbookSchoolLevelSummary,
  getTextbookSubSubject,
  getTextbookSubjectAreaKey,
  getTextbookSubjectWriteValue,
  getTextbookTaxonomySelection,
  mergeTextbookSubSubjectSettings,
  toggleTextbookGradeLevel,
  toggleTextbookSchoolLevel,
  validateTextbookTaxonomyForWrite,
} from "./textbook-taxonomy";

type TextbookAmountMode = "salePrice" | "stockValue";
type PreparedHandoffDownload = {
  id: string;
  label: string;
  filename: string;
  url: string;
};

function buildPreparedPurchaseRendererData(rows: TextbookPurchaseCaseRow[]) {
  const unique = (items: Array<Row | null>) => [...new Map(items.filter((item): item is Row => Boolean(item)).map((item) => [getRecordId(item), item])).values()];
  return {
    orders: unique(rows.map((row) => row.line.order)),
    lines: rows.map((row) => row.line),
    textbooks: unique(rows.map((row) => row.references.textbook)),
    publishers: unique(rows.map((row) => row.references.publisher)),
    locations: unique(rows.map((row) => row.references.location)),
    suppliers: unique(rows.map((row) => row.references.supplier)),
    classes: unique(rows.map((row) => row.references.class)),
  };
}

function buildPreparedSaleRendererData(rows: SaleLineRow[]) {
  const unique = (items: Array<Row | null>) => [...new Map(items.filter((item): item is Row => Boolean(item)).map((item) => [getRecordId(item), item])).values()];
  return {
    sales: unique(rows.map((row) => row.sale)), lines: rows.map((row) => row.line), textbooks: unique(rows.map((row) => row.textbook)),
    classes: unique(rows.map((row) => row.class)), students: unique(rows.map((row) => row.student)), locations: unique(rows.map((row) => row.location)),
  };
}
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
  totalCount?: number;
  onConfirm: () => Promise<boolean>;
};

const statusOptions = [
  { value: "active", label: "사용중" },
  { value: "inactive", label: "미사용" },
];

const textbookCopyScopeOptions = [
  { value: "student", label: "학생용" },
  { value: "teacher", label: "교사용" },
] as const;

const purchaseProcessQuantityColumns = [
  { id: "requested", label: "요청", kind: "requested", orderOnly: false },
  { id: "ordered", label: "주문", kind: "ordered", orderOnly: true },
  { id: "received", label: "입고", kind: "received", orderOnly: true },
] as const;

function PurchaseQuantityPair({ student, teacher, label }: { student: number | null; teacher: number | null; label: string }) {
  return (
    <div className="grid min-w-20 gap-1 text-xs tabular-nums">
      {([ ["student", "학생용", student], ["teacher", "교사용", teacher] ] as const).map(([scope, scopeLabel, value]) => (
        <div key={scope} data-copy-scope={scope} aria-label={`${scopeLabel} ${label} ${value === null ? "집계 확인 필요" : formatQuantity(value)}`} className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-normal text-muted-foreground">{scopeLabel}</span>
          <span className="font-medium text-foreground">{value === null ? "—" : formatQuantity(value)}</span>
        </div>
      ))}
    </div>
  );
}

const emptyMasterForm = {
  id: "",
  title: "",
  subject: "english",
  subjectAreaKey: "",
  schoolLevels: [] as string[],
  gradeLevels: [] as string[],
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
  subjectAreaKey: "",
  schoolLevels: null as string[] | null,
  gradeLevels: null as string[] | null,
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

const textbookHistoryDeleteAdminEmails = new Set(["yeoyuasset@naver.com"]);

const textbookTabTriggerClassName =
  "min-h-9 gap-1.5 rounded-md border border-transparent text-xs text-muted-foreground data-[state=active]:border-border/70 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs motion-reduce:transition-none";
const TEXTBOOK_RESULTS_CLASS_NAME = "min-w-0 md:h-[min(42rem,max(20rem,calc(100dvh-20.25rem)))] md:overflow-y-auto [scrollbar-gutter:stable]";
const stickyActionHeadClassName =
  "sticky right-0 z-20 bg-muted shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]";
const stickyActionCellClassName =
  "sticky right-0 bg-background group-hover/data-table-row:bg-muted group-data-[state=selected]/data-table-row:bg-accent shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.35)]";

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

function isTextbookUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value));
}

function isExactAcceptedInput(acceptedInput: unknown, currentInput: unknown) {
  return acceptedInput !== null && currentInput !== null
    && JSON.stringify(acceptedInput) === JSON.stringify(currentInput);
}

function getCanonicalTextbookDetail(state: TextbookNavigationState) {
  const detail = state.detail;
  if (!detail) return null;
  if (detail.kind === "master" && state.tab === "master") return detail;
  if (detail.kind === "purchase" && (state.tab === "requests" || state.tab === "purchase")) return detail;
  if (detail.kind === "sale" && state.tab === "sales") return detail;
  return null;
}

// Kept as the source-locked legacy metadata ordering contract until Task 5d removes its loader consumer.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function uniqueSortedLabels(values: unknown[]) {
  const labelsByKey = new Map<string, string>();
  for (const value of values) {
    const label = text(value);
    if (!label || label === "미분류") continue;
    const key = label.toLowerCase();
    if (!labelsByKey.has(key)) labelsByKey.set(key, label);
  }
  return [...labelsByKey.values()].sort((left, right) => left.localeCompare(right, "ko", { numeric: true }));
}

function getTextbookIdentityLabel(row: Row) {
  return compactUniqueLabels([
    getTextbookTitle(row),
    getKnownPublisherLabel(row),
    getSubjectLabel(row.subject),
    getTextbookSchoolLevelSummary(row),
    getTextbookGradeSummary(row),
    getTextbookSubSubject(row),
  ]).join(" · ");
}

function getCategoryLabel(row: Row) {
  return getTextbookCategoryLabel(row);
}

function getTextbookGroupLabel(row: Row) {
  return getSubjectLabel(row.subject);
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








function formatPurchaseScopeQuantityMetric(studentQuantity: number, teacherQuantity: number) {
  return [
    studentQuantity > 0 ? `학생용 ${formatQuantity(studentQuantity)}권` : "",
    teacherQuantity > 0 ? `교사용 ${formatQuantity(teacherQuantity)}권` : "",
  ].filter(Boolean).join(" · ") || "0권";
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

function getStudentName(row: Row) {
  return text(row.name || row.student_name || row.studentName || row.id);
}

function getTextbookCopyScopeLabel(value: unknown) {
  return getTextbookCopyScope({ copyScope: value }) === "teacher" ? "교사용" : "학생용";
}

function buildKyoboSearchUrl(title: string) {
  return `https://search.kyobobook.co.kr/search?keyword=${encodeURIComponent(title)}`;
}

function getInventoryCountDraftKey(textbookId: string, locationId: string) {
  return `${textbookId}:${locationId}`;
}

function getInventoryCurrentQuantityDraft(row: InventoryCountRow) {
  return String(Math.max(0, numberValue(row.currentQuantity)));
}

function inventoryQuantityTone(totalQuantity: number) {
  if (totalQuantity < 0) return "text-red-700";
  if (totalQuantity === 0) return "text-zinc-500";
  return "text-foreground";
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

async function captureHandoffDocument(element: HTMLElement, capture: typeof captureElementAsPngBlob, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const tableOverflow = Math.max(0, ...Array.from(element.querySelectorAll("table"), (table) =>
    table.scrollWidth - (table.parentElement?.clientWidth || 0),
  ));
  const width = Math.max(720, Math.ceil(element.scrollWidth + tableOverflow));
  const surface = element.cloneNode(true) as HTMLElement;
  // Export a separate surface so capture sizing never reflows the visible preview.
  surface.querySelectorAll("[data-handoff-toolbar]").forEach((toolbar) => toolbar.remove());
  surface.removeAttribute("id");
  surface.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, { position: "fixed", left: "-100000px", top: "0", width: `${width}px`, pointerEvents: "none" });
  host.appendChild(surface);
  document.body.appendChild(host);
  try {
    const blob = await capture(surface, { width, padding: 0, scale: 2, backgroundColor: "#ffffff" });
    signal?.throwIfAborted();
    return blob;
  } finally {
    host.remove();
  }
}

async function downloadHandoffImage(element: HTMLElement, filename: string, signal?: AbortSignal) {
  const blob = await captureHandoffDocument(element, captureElementAsPngBlob, signal);
  return createPreparedHandoffDownload(blob, filename, "png", "이미지");
}

async function downloadHandoffPdf(element: HTMLElement, filename: string, signal?: AbortSignal) {
  const blob = await captureHandoffDocument(element, captureElementAsPdfBlob, signal);
  return createPreparedHandoffDownload(blob, filename, "pdf", "PDF");
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

function isPreparedSchemaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  const code = text(candidate.code);
  if (["textbook_read_rpc_unavailable", "PGRST202", "PGRST204", "PGRST205", "42883", "42P01", "42703"].includes(code)) return true;
  return candidate.cause !== error && isPreparedSchemaError(candidate.cause);
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
  };
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

// Initial data and automatic defaults are not user edits. A default only advances
// the baseline while the form is still unchanged; accepted writes reset their own form.
function useTextbookFormDraft<T>(initial: T) {
  const [state, dispatch] = useReducer((current: { value: T; baseline: T }, action: { value: SetStateAction<T>; mode: "edit" | "replace" | "defaults" }) => {
    const value = typeof action.value === "function" ? (action.value as (previous: T) => T)(current.value) : action.value;
    const baseline = action.mode === "replace" || (action.mode === "defaults" && JSON.stringify(current.value) === JSON.stringify(current.baseline))
      ? value : current.baseline;
    return Object.is(value, current.value) && Object.is(baseline, current.baseline) ? current : { value, baseline };
  }, { value: initial, baseline: initial });
  const edit = useCallback((value: SetStateAction<T>) => dispatch({ value, mode: "edit" }), []);
  const replace = useCallback((value: SetStateAction<T>) => dispatch({ value, mode: "replace" }), []);
  const defaults = useCallback((value: SetStateAction<T>) => dispatch({ value, mode: "defaults" }), []);
  return [state.value, edit, replace, defaults, JSON.stringify(state.value) !== JSON.stringify(state.baseline)] as const;
}

export function TextbookOperationsWorkspace() {
  const { user, role, loading } = useAuth();
  if (loading || !user?.id || !role) return <div role="status">로그인 정보를 확인하는 중입니다.</div>;
  return <TextbookOperationsWorkspaceContent key={`${user.id}:${role}`} />;
}

function TextbookOperationsWorkspaceContent() {
  const { user, role, canManageAll, isAdmin, isStaff, isTeacher } = useAuth();
  const searchParams = useSearchParams();
  const searchParamString = searchParams.toString();
  const initialNavigationRef = useRef(parseTextbookNavigation(new URLSearchParams(searchParamString)));
  const initialPrimaryFilters = initialNavigationRef.current.primary.filters as Row;
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const [actionErrorMessage, setActionErrorMessage] = useState("");
  const [actionErrorOwner, setActionErrorOwner] = useState("");
  const pendingActionsRef = useRef(new Set<string>());
  const [query, setQuery] = useState(() => text(initialPrimaryFilters.search));
  const [operationQuery, setOperationQuery] = useState(() => text(initialPrimaryFilters.search));
  const deferredQuery = useDeferredValue(query);
  const deferredOperationQuery = useDeferredValue(operationQuery);
  const masterSearchRef = useRef<HTMLInputElement>(null);
  const operationSearchRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<TextbookTab>(initialNavigationRef.current.tab);
  const [textbookQualityFilter, setTextbookQualityFilter] = useState<"all" | "inactive">(() => initialPrimaryFilters.quality === "inactive" ? "inactive" : "all");
  const [subjectGroupFilter, setSubjectGroupFilter] = useState(() => text(initialPrimaryFilters.subject) || "all");
  const [schoolLevelGroupFilter, setSchoolLevelGroupFilter] = useState(() => text(initialPrimaryFilters.schoolLevel) || "all");
  const [gradeLevelGroupFilter, setGradeLevelGroupFilter] = useState(() => text(initialPrimaryFilters.gradeLevel) || "all");
  const [categoryGroupFilter, setCategoryGroupFilter] = useState(() => text(initialPrimaryFilters.subSubject) || "all");
  const [collapsedTextbookGroups, setCollapsedTextbookGroups] = useState<string[]>([]);
  const [masterBulkControlsOpen, setMasterBulkControlsOpen] = useState(false);
  const masterBulkDialogRevisionRef = useRef(0);
  const [selectedTextbookIds, setSelectedTextbookIds] = useState<string[]>([]);
  const [bulkTextbookPatch, setBulkTextbookPatch] = useState(emptyBulkTextbookPatch);
  const [masterForm, setMasterForm, replaceMasterForm, , masterFormDirty] = useTextbookFormDraft(emptyMasterForm);
  const [masterDialogOpen, setMasterDialogOpen] = useState(false);
  const dialogOpenerRef = useRef<HTMLElement | null>(null);
  const [textbookDeleteDialogOpen, setTextbookDeleteDialogOpen] = useState(false);
  const textbookCleanupPreviewRef = useRef<TextbookConfirmationPreviewItem[]>([]);
  const [confirmationRequest, setConfirmationRequest] = useState<TextbookConfirmationRequest | null>(null);
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [confirmationError, setConfirmationError] = useState("");
  const confirmationPendingRef = useRef(false);
  const [purchaseForm, setPurchaseForm, replacePurchaseForm, applyPurchaseDefaults, purchaseFormDirty] = useTextbookFormDraft(emptyPurchaseForm);
  const [purchaseDialogOpen, setPurchaseDialogOpen] = useState(false);
  const [purchaseRequestInputMode, setPurchaseRequestInputMode] = useState<"catalog" | "manual">("catalog");
  const purchaseAutoDefaultsRef = useRef({ title: "", supplierId: "", unitCost: "", requestBy: "", locationId: "" });
  const [selectedPurchaseLineId, setSelectedPurchaseLineId] = useState("");
  const [selectedPurchaseScopeLineIds, setSelectedPurchaseScopeLineIds] = useState<Record<TextbookCopyScope, string>>({ student: "", teacher: "" });
  const [selectedPurchaseLineIds, setSelectedPurchaseLineIds] = useState<string[]>([]);
  const [bulkOrderDialogOpen, setBulkOrderDialogOpen] = useState(false);
  const [bulkOrderQuantities, setBulkOrderQuantities, replaceBulkOrderQuantities, , bulkOrderFormDirty] = useTextbookFormDraft<Record<string, string>>({});
  const [purchaseBoardScope, setPurchaseBoardScope] = useState<PurchaseBoardScope>(() => (text(initialPrimaryFilters.boardScope) || "active") as PurchaseBoardScope);
  const [purchaseRequestFilter, setPurchaseRequestFilter] = useState<PurchaseRequestFilter>(() => (text(initialPrimaryFilters.requestFilter) || "all") as PurchaseRequestFilter);
  const [purchaseOrderFilter, setPurchaseOrderFilter] = useState<PurchaseOrderFilter>(() => (text(initialPrimaryFilters.orderFilter) || "all") as PurchaseOrderFilter);
  const [inventoryCountLocationId, setInventoryCountLocationId] = useState("");
  const [inventoryCountDrafts, setInventoryCountDrafts] = useState<Record<string, string>>({});
  const [inventoryCountMemoDrafts, setInventoryCountMemoDrafts] = useState<Record<string, string>>({});
  const inventoryCountDraftRevisionsRef = useRef<Record<string, number>>({});
  const inventoryCountRequestsRef = useRef<Record<string, { fingerprint: string; requestId: string; countedAt: string }>>({});
  const textbookSelectionRevisionsRef = useRef<Record<string, number>>({});
  const [saleForm, setSaleForm, replaceSaleForm, applySaleDefaults, saleFormDirty] = useTextbookFormDraft(emptySaleForm);
  const saleAutoDefaultsRef = useRef({ locationId: "" });
  const [salesProcessFilter, setSalesProcessFilter] = useState<SalesProcessFilter>(() => (text(initialPrimaryFilters.status) || "all") as SalesProcessFilter);
  const [saleHistoryFilters, setSaleHistoryFilters] = useState(initialNavigationRef.current.history.filters);
  const [observedQuery, setObservedQuery] = useState(searchParamString);
  const [navigationKey, setNavigationKey] = useState(searchParamString);
  const handledQuery = useRef(searchParamString);
  const adoptLocationQuery = useCallback((queryString: string) => {
    if (handledQuery.current === queryString) return;
    handledQuery.current = queryString;
    setNavigationKey(queryString);
    const restored = parseTextbookNavigation(new URLSearchParams(queryString));
    const restoredDetail = getCanonicalTextbookDetail(restored);
    initialNavigationRef.current = restored;
    const filters = restored.primary.filters as Row;
    setActiveTab(restored.tab);
    setQuery(text(filters.search));
    setOperationQuery(text(filters.search));
    setSubjectGroupFilter(text(filters.subject) || "all");
    setSchoolLevelGroupFilter(text(filters.schoolLevel) || "all");
    setGradeLevelGroupFilter(text(filters.gradeLevel) || "all");
    setCategoryGroupFilter(text(filters.subSubject) || "all");
    setTextbookQualityFilter(filters.quality === "inactive" ? "inactive" : "all");
    setPurchaseBoardScope((text(filters.boardScope) || "active") as PurchaseBoardScope);
    setPurchaseRequestFilter((text(filters.requestFilter) || "all") as PurchaseRequestFilter);
    setPurchaseOrderFilter((text(filters.orderFilter) || "all") as PurchaseOrderFilter);
    setSalesProcessFilter((text(filters.status) || "all") as SalesProcessFilter);
    setSaleHistoryFilters(restored.history.filters);
    const nextMasterDetailId = restoredDetail?.kind === "master" ? restoredDetail.id : "";
    const nextPurchaseDetail = restoredDetail?.kind === "purchase" ? { anchorLineId: restoredDetail.id, mode: restored.tab === "requests" ? "request" as const : "order" as const } : null;
    setSelectedMasterDetailId(nextMasterDetailId);
    setSelectedPurchaseDetail(nextPurchaseDetail);
    setSelectedSaleDetailId(restoredDetail?.kind === "sale" ? restoredDetail.id : "");
    setMasterDialogOpen(false);
    replaceMasterForm(emptyMasterForm);
    setPurchaseDialogOpen(false);
    purchaseAutoDefaultsRef.current = { title: "", supplierId: "", unitCost: "", requestBy: "", locationId: "" };
    setSelectedPurchaseLineId("");
    setSelectedPurchaseScopeLineIds({ student: "", teacher: "" });
    replacePurchaseForm(emptyPurchaseForm);
    setPurchaseRequestInputMode("catalog");
    setSelectedTextbookIds([]);
    setSelectedPurchaseLineIds([]);
    setSelectedSaleLineIds([]);
    setMasterBulkControlsOpen(false);
    setBulkTextbookPatch(emptyBulkTextbookPatch);
    setBulkOrderDialogOpen(false);
    replaceBulkOrderQuantities({});
  }, [replaceMasterForm, replacePurchaseForm, replaceBulkOrderQuantities]);
  if (observedQuery !== searchParamString) {
    setObservedQuery(searchParamString);
    adoptLocationQuery(searchParamString);
  }
  useEffect(() => {
    const onPopState = () => adoptLocationQuery(new URLSearchParams(window.location.search).toString());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [adoptLocationQuery]);
  const [selectedSaleLineIds, setSelectedSaleLineIds] = useState<string[]>([]);
  const [saleDialogOpen, setSaleDialogOpen] = useState(false);
  const [selectedMasterDetailId, setSelectedMasterDetailId] = useState(() => {
    const detail = getCanonicalTextbookDetail(initialNavigationRef.current);
    return detail?.kind === "master" ? detail.id : "";
  });
  const [selectedPurchaseDetail, setSelectedPurchaseDetail] = useState<{ anchorLineId: string; mode: "request" | "order" } | null>(() => {
    const detail = getCanonicalTextbookDetail(initialNavigationRef.current);
    return detail?.kind === "purchase"
    ? { anchorLineId: detail.id, mode: initialNavigationRef.current.tab === "requests" ? "request" : "order" }
    : null;
  });
  const [selectedSaleDetailId, setSelectedSaleDetailId] = useState(() => {
    const detail = getCanonicalTextbookDetail(initialNavigationRef.current);
    return detail?.kind === "sale" ? detail.id : "";
  });
  const [excludedStudentIds, setExcludedStudentIds] = useState<string[]>([]);
  const [saleStudentQuery, setSaleStudentQuery] = useState("");
  const masterDraftDirty = masterDialogOpen && masterFormDirty;
  const purchaseDraftDirty = purchaseDialogOpen && purchaseFormDirty;
  const saleDraftDirty = saleDialogOpen && (saleFormDirty || excludedStudentIds.length > 0);
  const masterBulkDraftDirty = JSON.stringify(bulkTextbookPatch) !== JSON.stringify(emptyBulkTextbookPatch);
  const bulkOrderDraftDirty = bulkOrderDialogOpen && bulkOrderFormDirty;
  const inventoryDraftDirty = Object.values(inventoryCountDrafts).some((value) => value !== "")
    || Object.values(inventoryCountMemoDrafts).some((value) => value !== "");
  const queryResetDraftDirty = masterDraftDirty || purchaseDraftDirty || masterBulkDraftDirty || bulkOrderDraftDirty;
  const { requestLocalAction, confirmation: draftNavigationConfirmation } = useDraftNavigation({
    dirty: queryResetDraftDirty || saleDraftDirty || inventoryDraftDirty,
  });


  const masterFilters = useMemo(() => ({
    search: deferredQuery,
    subject: subjectGroupFilter,
    schoolLevel: schoolLevelGroupFilter,
    gradeLevel: gradeLevelGroupFilter,
    subSubject: categoryGroupFilter,
    quality: textbookQualityFilter,
    inventory: "all" as const,
  }), [categoryGroupFilter, deferredQuery, gradeLevelGroupFilter, schoolLevelGroupFilter, subjectGroupFilter, textbookQualityFilter]);
  const purchaseFilters = useMemo(() => ({
    search: deferredOperationQuery,
    boardScope: purchaseBoardScope,
    requestFilter: purchaseRequestFilter,
    orderFilter: purchaseOrderFilter,
  }), [deferredOperationQuery, purchaseBoardScope, purchaseOrderFilter, purchaseRequestFilter]);
  const salesFilters = useMemo(() => ({ search: deferredOperationQuery, status: salesProcessFilter }), [deferredOperationQuery, salesProcessFilter]);
  const commitPrimaryPage = useCallback((commit: { page: number; pageSize: 10 | 15 | 20; filters: TextbookNavigationState["primary"]["filters"] }) => {
    const parsed = parseTextbookNavigation(new URLSearchParams(window.location.search));
    const next = serializeTextbookNavigation(new URLSearchParams(window.location.search), {
      ...parsed,
      tab: activeTab,
      primary: { page: commit.page, pageSize: commit.pageSize, filters: commit.filters },
    });
    const queryString = next.toString();
    handledQuery.current = queryString;
    window.history.replaceState(null, "", `${window.location.pathname}?${queryString}`);
  }, [activeTab]);
  const primaryRestoredPage = initialNavigationRef.current.tab === activeTab ? initialNavigationRef.current.primary.page : 1;
  const primaryRestoredPageSize = initialNavigationRef.current.tab === activeTab ? initialNavigationRef.current.primary.pageSize : undefined;
  const managementEnabled = Boolean(canManageAll || isAdmin || isStaff || role === "admin" || role === "staff");
  const selectedFormBookReference = purchaseDialogOpen
    ? purchaseForm.textbookId || (purchaseRequestInputMode === "manual" ? normalizeStoredTextInput(purchaseForm.requestedTextbookTitle) : "")
    : saleDialogOpen ? saleForm.textbookId : "";
  const selectedFormClassId = purchaseDialogOpen ? purchaseForm.classId : saleDialogOpen && getTextbookCopyScope(saleForm) === "student" ? saleForm.classId : "";
  const selectedFormLocationId = purchaseDialogOpen ? purchaseForm.locationId : saleDialogOpen ? saleForm.locationId : "";
  const selectedBookInput = selectedFormBookReference ? {
    reference: selectedFormBookReference,
    activeOnly: true,
    scope: purchaseDialogOpen && purchaseForm.requestStage === "request" ? "request" as const : "management" as const,
    fallbackSupplier: purchaseForm.supplierId,
  } : null;
  const selectedClassInput = isTextbookUuid(selectedFormClassId) ? selectedFormClassId : null;
  const selectedLocationInput = isTextbookUuid(selectedFormLocationId) ? selectedFormLocationId : null;
  const masterOptionsInput = activeTab === "master" || activeTab === "inventory" || masterDialogOpen ? {
    subject: masterForm.subject as "english" | "math" | "science" | "other",
    listSubject: subjectGroupFilter as "all" | "english" | "math" | "science" | "other",
    bulkSubject: bulkTextbookPatch.subject as "keep" | "english" | "math" | "science" | "other",
  } : null;
  const canonicalMasterCategory = getTextbookCategoryLabel({
    school_level: masterForm.schoolLevels.length === 1 ? masterForm.schoolLevels[0] : "",
    grade_level: masterForm.gradeLevels.length === 1 ? masterForm.gradeLevels[0] : "",
    sub_subject: masterForm.subSubject,
    category: "",
  });
  const masterDuplicateInput = masterDialogOpen && normalizeStoredTextInput(masterForm.title) ? {
    excludeId: isTextbookUuid(masterForm.id) ? masterForm.id : null,
    title: normalizeStoredTextInput(masterForm.title),
    subject: normalizeStoredTextInput(masterForm.subject),
    publisher: normalizeStoredTextInput(masterForm.publisher),
    category: canonicalMasterCategory === "미분류" ? "" : canonicalMasterCategory,
  } : null;
  const classSalePreviewInput = saleDialogOpen && getTextbookCopyScope(saleForm) === "student"
    && [saleForm.classId, saleForm.textbookId, saleForm.locationId].every(isTextbookUuid)
    ? { classId: saleForm.classId, textbookId: saleForm.textbookId, locationId: saleForm.locationId, chargeMonth: normalizeMonthInput(saleForm.chargeMonth) }
    : null;
  const teacherSaleBalanceInput = saleDialogOpen && getTextbookCopyScope(saleForm) === "teacher"
    && isTextbookUuid(saleForm.textbookId) && isTextbookUuid(saleForm.locationId)
    ? { textbookIds: [saleForm.textbookId], locationId: saleForm.locationId }
    : null;
  const purchaseBalanceInput = purchaseDialogOpen && purchaseForm.requestStage !== "request"
    && isTextbookUuid(purchaseForm.textbookId) && isTextbookUuid(purchaseForm.locationId)
    ? { textbookIds: [purchaseForm.textbookId], locationId: purchaseForm.locationId }
    : null;
  const referenceData = useTextbookReferenceData({
    viewerId: text(user?.id), viewerRole: text(role), authReady: Boolean(user?.id && role), managementEnabled,
    bookOptions: { enabled: purchaseDialogOpen || saleDialogOpen },
    classOptions: { enabled: purchaseDialogOpen || (saleDialogOpen && getTextbookCopyScope(saleForm) === "student") },
    teacherOptions: { enabled: purchaseDialogOpen || (saleDialogOpen && getTextbookCopyScope(saleForm) === "teacher") },
    locationOptions: { enabled: activeTab === "inventory" || purchaseDialogOpen || saleDialogOpen },
    selectedBook: selectedBookInput,
    selectedClassId: selectedClassInput,
    selectedLocationId: selectedLocationInput,
    masterOptions: masterOptionsInput,
    masterDetailId: isTextbookUuid(selectedMasterDetailId) ? selectedMasterDetailId : null,
    purchaseDetailInput: selectedPurchaseDetail,
    saleDetailId: isTextbookUuid(selectedSaleDetailId) ? selectedSaleDetailId : null,
    masterDuplicateInput,
    classSalePreviewInput,
    teacherSaleBalanceInput,
    purchaseBalanceInput,
    });
  const acceptedSelectedBook = isExactAcceptedInput(referenceData.selectedBook.acceptedInput, selectedBookInput)
    ? referenceData.selectedBook.value?.row || null : null;
  const acceptedSelectedClass = isExactAcceptedInput(referenceData.selectedClass.acceptedInput, selectedClassInput)
    ? referenceData.selectedClass.value?.row || null : null;
  const acceptedSelectedLocation = isExactAcceptedInput(referenceData.selectedLocation.acceptedInput, selectedLocationInput)
    ? referenceData.selectedLocation.value?.row || null : null;
  const acceptedMasterOptions = isExactAcceptedInput(referenceData.masterOptions.acceptedInput, masterOptionsInput)
    ? referenceData.masterOptions.value : null;
  const acceptedMasterDetail = isExactAcceptedInput(referenceData.masterDetail.acceptedInput, isTextbookUuid(selectedMasterDetailId) ? selectedMasterDetailId : null)
    ? referenceData.masterDetail.value : null;
  const acceptedPurchaseDetail = isExactAcceptedInput(referenceData.purchaseDetail.acceptedInput, selectedPurchaseDetail)
    ? referenceData.purchaseDetail.value : null;
  const acceptedSaleDetail = isExactAcceptedInput(referenceData.saleDetail.acceptedInput, isTextbookUuid(selectedSaleDetailId) ? selectedSaleDetailId : null)
    ? referenceData.saleDetail.value : null;
  const acceptedMasterDuplicate = isExactAcceptedInput(referenceData.masterDuplicate.acceptedInput, masterDuplicateInput)
    ? referenceData.masterDuplicate.value : null;
  const acceptedClassSalePreview = isExactAcceptedInput(referenceData.classSalePreview.acceptedInput, classSalePreviewInput)
    ? referenceData.classSalePreview.value : null;
  const acceptedTeacherSaleBalance = isExactAcceptedInput(referenceData.teacherSaleBalance.acceptedInput, teacherSaleBalanceInput)
    ? referenceData.teacherSaleBalance.value : null;
  const acceptedPurchaseBalance = isExactAcceptedInput(referenceData.purchaseBalance.acceptedInput, purchaseBalanceInput)
    ? referenceData.purchaseBalance.value : null;
  const purchaseReferenceError = referenceData.selectedBook.error
    ? referenceData.selectedBook : referenceData.selectedClass.error
      ? referenceData.selectedClass : referenceData.selectedLocation.error
        ? referenceData.selectedLocation : purchaseBalanceInput && referenceData.purchaseBalance.error ? referenceData.purchaseBalance : null;
  const saleReferenceError = referenceData.classSalePreview.error
    ? referenceData.classSalePreview : referenceData.teacherSaleBalance.error
      ? referenceData.teacherSaleBalance : referenceData.selectedBook.error
        ? referenceData.selectedBook : referenceData.selectedClass.error
          ? referenceData.selectedClass : referenceData.selectedLocation.error ? referenceData.selectedLocation : null;
  const inventoryReferenceLocations = useMemo<Row[]>(() => referenceData.locationOptions.rows.map((option) => ({
    id: option.value, name: option.label, code: option.searchText || option.description || "",
  })), [referenceData.locationOptions.rows]);
  const inventoryDefaultLocationId = referenceData.locationOptions.defaultLocation?.id || "";
  const inventoryHasExplicitLocation = Boolean(inventoryCountLocationId && inventoryReferenceLocations.some((location) => getRecordId(location) === inventoryCountLocationId));
  const inventoryLocationReference = {
    ready: Boolean(!referenceData.locationOptions.loading && !referenceData.locationOptions.error && (inventoryDefaultLocationId || inventoryHasExplicitLocation)),
    locations: inventoryReferenceLocations,
    defaultLocationId: inventoryDefaultLocationId,
    error: referenceData.locationOptions.error
      ? getTextbookActionErrorMessage(referenceData.locationOptions.error)
      : !referenceData.locationOptions.loading && referenceData.locationOptions.acceptedInput && !inventoryDefaultLocationId && !inventoryHasExplicitLocation
        ? "기본 재고 위치가 설정되지 않았습니다. 위치 설정 후 다시 시도하세요." : "",
  };
  useEffect(() => {
    const resolved = acceptedSelectedBook;
    if (!purchaseDialogOpen || !resolved) return;
    const supplierId = resolved.configuredSupplierId;
    const supplierRows = resolved.supplier ? [resolved.supplier] : [];
    applyPurchaseDefaults((current) => {
      if (current.textbookId && getRecordId(resolved.textbook) !== current.textbookId) return current;
      const nextTitle = getTextbookTitle(resolved.textbook);
      const nextUnitCost = String(getConfiguredTextbookPurchaseUnitCost(resolved.textbook, supplierId, supplierRows, current.unitCost, current.copyScope));
      const canSetTitle = purchaseRequestInputMode === "catalog" && (!current.requestedTextbookTitle || current.requestedTextbookTitle === purchaseAutoDefaultsRef.current.title);
      const canSetSupplier = !current.supplierId || current.supplierId === purchaseAutoDefaultsRef.current.supplierId;
      const canSetUnitCost = !current.unitCost || current.unitCost === purchaseAutoDefaultsRef.current.unitCost;
      purchaseAutoDefaultsRef.current = {
        ...purchaseAutoDefaultsRef.current,
        title: canSetTitle ? nextTitle : purchaseAutoDefaultsRef.current.title,
        supplierId: canSetSupplier ? supplierId : purchaseAutoDefaultsRef.current.supplierId,
        unitCost: canSetUnitCost ? nextUnitCost : purchaseAutoDefaultsRef.current.unitCost,
      };
      return {
        ...current,
        requestedTextbookTitle: canSetTitle ? nextTitle : current.requestedTextbookTitle,
        supplierId: canSetSupplier ? supplierId : current.supplierId,
        unitCost: canSetUnitCost ? nextUnitCost : current.unitCost,
      };
    });
  }, [acceptedSelectedBook, applyPurchaseDefaults, purchaseDialogOpen, purchaseRequestInputMode]);
  useEffect(() => {
    const resolved = acceptedSelectedClass;
    if (!resolved) return;
    if (purchaseDialogOpen && purchaseForm.classId === resolved.id) {
      const nextTeacher = resolved.defaultTeacherName;
      const nextLocation = resolved.inferredLocation?.id || "";
      applyPurchaseDefaults((current) => {
        if (current.classId !== resolved.id) return current;
        const canSetTeacher = !current.requestBy || current.requestBy === purchaseAutoDefaultsRef.current.requestBy;
        const canSetLocation = Boolean(nextLocation) && (!current.locationId || current.locationId === purchaseAutoDefaultsRef.current.locationId);
        purchaseAutoDefaultsRef.current = {
          ...purchaseAutoDefaultsRef.current,
          requestBy: canSetTeacher ? nextTeacher : purchaseAutoDefaultsRef.current.requestBy,
          locationId: canSetLocation ? nextLocation : purchaseAutoDefaultsRef.current.locationId,
        };
        return { ...current, requestBy: canSetTeacher ? nextTeacher : current.requestBy, locationId: canSetLocation ? nextLocation : current.locationId };
      });
    }
    if (saleDialogOpen && saleForm.classId === resolved.id && resolved.inferredLocation?.id) {
      applySaleDefaults((current) => {
        if (current.classId !== resolved.id) return current;
        const canSetLocation = !current.locationId || current.locationId === saleAutoDefaultsRef.current.locationId;
        if (canSetLocation) saleAutoDefaultsRef.current.locationId = resolved.inferredLocation?.id || "";
        return canSetLocation ? { ...current, locationId: resolved.inferredLocation?.id || current.locationId } : current;
      });
    }
  }, [acceptedSelectedClass, applyPurchaseDefaults, applySaleDefaults, purchaseDialogOpen, purchaseForm.classId, saleDialogOpen, saleForm.classId]);
  useEffect(() => {
    const row = acceptedMasterDetail?.row;
    if (!row) return;
    selectMasterTextbook(row);
    // The selector intentionally remains an event-style helper; request identity guards this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptedMasterDetail]);
  useEffect(() => {
    const row = acceptedPurchaseDetail?.row;
    if (!row || !selectedPurchaseDetail) return;
    selectPurchaseLine(row.line, row.line.order || undefined, selectedPurchaseDetail.mode, true, row);
    // The selector intentionally remains an event-style helper; request identity guards this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptedPurchaseDetail, selectedPurchaseDetail]);
  useEffect(() => {
    if (activeTab === "inventory" && inventoryDefaultLocationId) setInventoryCountLocationId((current) => current || inventoryDefaultLocationId);
    if (purchaseDialogOpen && inventoryDefaultLocationId) applyPurchaseDefaults((current) => {
      if (current.locationId) return current;
      purchaseAutoDefaultsRef.current.locationId = inventoryDefaultLocationId;
      return { ...current, locationId: inventoryDefaultLocationId };
    });
    if (saleDialogOpen && inventoryDefaultLocationId) applySaleDefaults((current) => {
      if (current.locationId) return current;
      saleAutoDefaultsRef.current.locationId = inventoryDefaultLocationId;
      return { ...current, locationId: inventoryDefaultLocationId };
    });
  }, [activeTab, applyPurchaseDefaults, applySaleDefaults, inventoryDefaultLocationId, purchaseDialogOpen, saleDialogOpen]);
  const preparedInventoryLocationId = inventoryCountLocationId || inventoryLocationReference.defaultLocationId;
  const selectInventoryCountLocation = useCallback((locationId: string) => {
    setInventoryCountLocationId(locationId);
  }, []);
  const numbered = useTextbookNumberedData({
    viewerId: text(user?.id),
    viewerRole: text(role),
    authReady: Boolean(user?.id && role),
    operationsEnabled: activeTab !== "requests",
    master: { enabled: activeTab === "master", filters: masterFilters, restoredPage: primaryRestoredPage, restoredPageSize: primaryRestoredPageSize, restorationKey: navigationKey },
    requests: { enabled: activeTab === "requests", filters: purchaseFilters, restoredPage: primaryRestoredPage, restoredPageSize: primaryRestoredPageSize, restorationKey: navigationKey },
    purchase: { enabled: activeTab === "purchase", filters: purchaseFilters, restoredPage: primaryRestoredPage, restoredPageSize: primaryRestoredPageSize, restorationKey: navigationKey },
    sales: { enabled: activeTab === "sales", filters: salesFilters, restoredPage: primaryRestoredPage, restoredPageSize: primaryRestoredPageSize, restorationKey: navigationKey },
    saleHistory: { enabled: activeTab === "sales", filters: saleHistoryFilters, restoredPage: initialNavigationRef.current.history.page, restoredPageSize: initialNavigationRef.current.history.pageSize, restorationKey: navigationKey },
    inventory: { enabled: activeTab === "inventory" && inventoryLocationReference.ready, filters: { ...masterFilters, quality: "all", locationId: preparedInventoryLocationId, audit: "all" }, restoredPage: primaryRestoredPage, restoredPageSize: primaryRestoredPageSize, restorationKey: navigationKey },
    inventoryHistory: { enabled: activeTab === "inventory" && inventoryLocationReference.ready, filters: { textbookId: null, locationId: preparedInventoryLocationId || null }, restoredPage: initialNavigationRef.current.history.page, restoredPageSize: initialNavigationRef.current.history.pageSize, restorationKey: navigationKey },
  });
  const actorKey = `${user?.id || ""}:${role || ""}`;
  const actionLifetimeRef = useRef({ actorKey, mounted: false });
  const actionSequenceRef = useRef(0);
  const purchaseDirectIdentity = JSON.stringify(selectedPurchaseDetail ? {
    anchorLineId: selectedPurchaseDetail.anchorLineId,
    mode: selectedPurchaseDetail.mode,
    memberLineIds: (["student", "teacher"] as TextbookCopyScope[]).map((scope) => selectedPurchaseScopeLineIds[scope]).filter(Boolean),
  } : null);
  const inventoryActionIdentity = JSON.stringify({
    selection: selectedTextbookIds,
    drafts: inventoryCountDrafts,
    memos: inventoryCountMemoDrafts,
    revisions: inventoryCountDraftRevisionsRef.current,
    selectionRevisions: textbookSelectionRevisionsRef.current,
  });
  const masterBulkIdentity = JSON.stringify({
    selection: selectedTextbookIds,
    selectionRevisions: Object.fromEntries(selectedTextbookIds.map((id) => [id, textbookSelectionRevisionsRef.current[id] || 0])),
    patch: bulkTextbookPatch,
  });
  const liveActionInputsRef = useRef({
    master: JSON.stringify(masterForm), purchase: JSON.stringify(purchaseForm), sale: JSON.stringify(saleForm),
    purchaseSelection: JSON.stringify(selectedPurchaseLineIds), saleSelection: JSON.stringify(selectedSaleLineIds),
    inventorySelection: JSON.stringify(selectedTextbookIds), masterSelection: JSON.stringify(selectedTextbookIds),
    purchaseDirect: purchaseDirectIdentity, saleRecipients: JSON.stringify(excludedStudentIds),
    bulkOrder: JSON.stringify({ selection: selectedPurchaseLineIds, quantities: bulkOrderQuantities }), inventory: inventoryActionIdentity, masterBulk: masterBulkIdentity,
  });
  liveActionInputsRef.current = {
    master: JSON.stringify(masterForm), purchase: JSON.stringify(purchaseForm), sale: JSON.stringify(saleForm),
    purchaseSelection: JSON.stringify(selectedPurchaseLineIds), saleSelection: JSON.stringify(selectedSaleLineIds),
    inventorySelection: JSON.stringify(selectedTextbookIds), masterSelection: JSON.stringify(selectedTextbookIds),
    purchaseDirect: purchaseDirectIdentity, saleRecipients: JSON.stringify(excludedStudentIds),
    bulkOrder: JSON.stringify({ selection: selectedPurchaseLineIds, quantities: bulkOrderQuantities }), inventory: inventoryActionIdentity, masterBulk: masterBulkIdentity,
  };
  useLayoutEffect(() => {
    actionLifetimeRef.current = { actorKey, mounted: true };
    return () => { actionLifetimeRef.current = { actorKey, mounted: false }; };
  }, [actorKey]);
  const isCurrentActionActor = useCallback((expectedActorKey: string) => (
    actionLifetimeRef.current.mounted && actionLifetimeRef.current.actorKey === expectedActorKey
  ), []);
  const invalidateMaster = useCallback(async () => {
    await Promise.all([numbered.master.refresh(), numbered.master.summary.retry(), numbered.operations.retry(), referenceData.masterOptions.retry()]);
  }, [numbered.master, numbered.operations, referenceData.masterOptions]);
  const invalidatePurchase = useCallback(async () => {
    await Promise.all([numbered.requests.refresh(), numbered.requests.summary.retry(), numbered.purchase.refresh(), numbered.purchase.summary.retry(), numbered.operations.retry(), referenceData.purchaseDetail.retry()]);
  }, [numbered.operations, numbered.purchase, numbered.requests, referenceData.purchaseDetail]);
  const invalidateSales = useCallback(async () => {
    await Promise.all([numbered.sales.refresh(), numbered.sales.summary.retry(), numbered.saleHistory.refresh(), numbered.saleHistory.summary.retry(), numbered.operations.retry(), referenceData.saleDetail.retry()]);
  }, [numbered.operations, numbered.saleHistory, numbered.sales, referenceData.saleDetail]);
  const invalidateInventory = useCallback(async () => {
    await Promise.all([numbered.inventory.refresh(), numbered.inventory.summary.retry(), numbered.inventoryHistory.refresh(), numbered.operations.retry()]);
  }, [numbered.inventory, numbered.inventoryHistory, numbered.operations]);
  const requestRendererData = useMemo(() => buildPreparedPurchaseRendererData(numbered.requests.rows), [numbered.requests.rows]);
  const purchaseRendererData = useMemo(() => buildPreparedPurchaseRendererData(numbered.purchase.rows), [numbered.purchase.rows]);
  const saleRendererData = useMemo(() => buildPreparedSaleRendererData(numbered.sales.rows), [numbered.sales.rows]);
  const activePrimaryState = activeTab === "master" ? numbered.master : activeTab === "requests" ? numbered.requests : activeTab === "purchase" ? numbered.purchase
    : activeTab === "sales" ? numbered.sales : numbered.inventory;
  const activeSummaryResource = activeTab === "master" ? numbered.master.summary : activeTab === "requests" ? numbered.requests.summary : activeTab === "purchase" ? numbered.purchase.summary
    : activeTab === "sales" ? numbered.sales.summary : activeTab === "inventory" ? numbered.inventory.summary : null;
  useEffect(() => {
    if (activePrimaryState.loading || activePrimaryState.error || !activePrimaryState.acceptedFilters || activePrimaryState.totalCount === null) return;
    commitPrimaryPage({ page: activePrimaryState.page, pageSize: activePrimaryState.pageSize, filters: activePrimaryState.acceptedFilters as TextbookNavigationState["primary"]["filters"] });
  }, [activePrimaryState.acceptedFilters, activePrimaryState.error, activePrimaryState.loading, activePrimaryState.page, activePrimaryState.pageSize, activePrimaryState.totalCount, commitPrimaryPage]);
  useEffect(() => {
    if (activeTab !== "sales" || numbered.saleHistory.loading || numbered.saleHistory.error || !numbered.saleHistory.acceptedFilters || numbered.saleHistory.totalCount === null) return;
    const current = new URLSearchParams(window.location.search);
    const parsed = parseTextbookNavigation(current);
    const next = serializeTextbookNavigation(current, { ...parsed, history: { page: numbered.saleHistory.page, pageSize: numbered.saleHistory.pageSize, filters: numbered.saleHistory.acceptedFilters } });
    const queryString = next.toString();
    handledQuery.current = queryString;
    window.history.replaceState(null, "", `${window.location.pathname}?${queryString}`);
  }, [activeTab, numbered.saleHistory.acceptedFilters, numbered.saleHistory.error, numbered.saleHistory.loading, numbered.saleHistory.page, numbered.saleHistory.pageSize, numbered.saleHistory.totalCount]);

  const locations = useMemo<Row[]>(() => {
    const direct = acceptedSelectedLocation;
    return [...new Map([
      ...inventoryReferenceLocations,
      ...(direct ? [{ id: direct.id, code: direct.code, name: direct.name }] : []),
    ].map((row) => [getRecordId(row), row])).values()];
  }, [acceptedSelectedLocation, inventoryReferenceLocations]);
  const selectedLocationId = purchaseForm.locationId;
  const saleLocationId = saleForm.locationId;
  const selectedInventoryCountLocationId = preparedInventoryLocationId;
  const preparedReferenceSchemaOwner = [
    masterDialogOpen && referenceData.masterOptions.error ? referenceData.masterOptions : null,
    masterDialogOpen && referenceData.masterDuplicate.error ? referenceData.masterDuplicate : null,
    purchaseDialogOpen && purchaseReferenceError ? purchaseReferenceError : null,
    saleDialogOpen && saleReferenceError ? saleReferenceError : null,
    activeTab === "inventory" && referenceData.locationOptions.error ? referenceData.locationOptions : null,
  ].find((owner) => owner && isPreparedSchemaError(owner.error)) || null;
  const preparedSchemaOwner = [
    { id: "page", error: activePrimaryState.error, retry: activePrimaryState.retry },
    { id: "summary", error: activeSummaryResource?.error, retry: activeSummaryResource?.retry || (() => Promise.resolve()) },
    { id: "operations", error: numbered.operations.error, retry: numbered.operations.retry },
  ].find((owner) => isPreparedSchemaError(owner.error)) || null;
  const schemaDisabled = Boolean(preparedSchemaOwner || preparedReferenceSchemaOwner);
  const schemaDisabledRef = useRef(schemaDisabled);
  schemaDisabledRef.current = schemaDisabled;
  const currentUserId = text(user?.id);
  const currentUserLabel = text(user?.email || user?.id);
  const currentUserEmail = normalizeEmailValue(user?.email);
  const canManageTextbookOperations = canManageAll || isAdmin || isStaff || role === "admin" || role === "staff";
  const canCreateTextbookRequest = isTeacher || canManageTextbookOperations;
  const canDeleteTextbookHistory =
    canManageAll ||
    isAdmin ||
    role === "admin" ||
    textbookHistoryDeleteAdminEmails.has(currentUserEmail);
  const configuredPublisherOptions = useMemo(() => acceptedMasterOptions?.publisherOptions.map((option) => option.label) || [], [acceptedMasterOptions]);
  const publisherGroupOptions = configuredPublisherOptions;
  const masterPublisherOptions = useMemo(() => {
    return [
      { value: "none", label: "선택" },
      ...(acceptedMasterOptions?.publisherOptions || []),
      ...(!configuredPublisherOptions.includes(masterForm.publisher) && masterForm.publisher
        ? [{ value: masterForm.publisher, label: masterForm.publisher, description: "현재" }] : []),
    ];
  }, [acceptedMasterOptions, configuredPublisherOptions, masterForm.publisher]);
  const textbookSubSubjectSettings = useMemo<TextbookSubSubjectSettingRecord[]>(
    () => mergeTextbookSubSubjectSettings((acceptedMasterOptions?.subSubjectOptions || []).map((name) => ({ name, subject: masterForm.subject, is_active: true }))),
    [acceptedMasterOptions, masterForm.subject],
  );
  const scienceSubjectAreaOptions = useMemo(
    () => (acceptedMasterOptions?.scienceSubjectAreas || [])
      .map((area) => ({
        value: text(area.area_key),
        label: text(area.label)
          || TEXTBOOK_SCIENCE_AREA_OPTIONS.find((option) => option.value === text(area.area_key))?.label
          || text(area.area_key),
      })),
    [acceptedMasterOptions],
  );
  const gradeLevelGroupOptions = useMemo(
    () => getGradeOptionsForSchoolLevel(schoolLevelGroupFilter === "all" ? "" : schoolLevelGroupFilter),
    [schoolLevelGroupFilter],
  );
  const acceptedMasterSummary = numbered.master.summary.value;
  const categoryGroupOptions = useMemo(
    () => acceptedMasterOptions?.categoryOptions || [],
    [acceptedMasterOptions],
  );
  const activeTextbookQualityFilter = activeTab === "master" ? textbookQualityFilter : "all";
  const textbookQualityFilterCounts = acceptedMasterSummary?.qualityCounts || null;
  const filteredInventory = numbered.master.rows;
  const masterVisibleInventory = numbered.master.rows;
  const inventoryById = useMemo(
    () => new Map(masterVisibleInventory.map((row) => [getRecordId(row), row])),
    [masterVisibleInventory],
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
      .filter((row): row is NonNullable<typeof row> => Boolean(row)),
    [inventoryById, selectedTextbookIds],
  );
  useEffect(() => {
    if (selectedTextbookRows.length === 0) setMasterBulkControlsOpen(false);
  }, [selectedTextbookRows.length]);
  const selectedTextbookCleanupRows = useMemo(
    () => buildTextbookCleanupPreviewRows(selectedTextbookRows),
    [selectedTextbookRows],
  );
  const selectedVisibleTextbookCount = useMemo(
    () => visibleTextbookIds.filter((id) => selectedTextbookIdSet.has(id)).length,
    [selectedTextbookIdSet, visibleTextbookIds],
  );
  const allVisibleTextbooksSelected = visibleTextbookIds.length > 0 && selectedVisibleTextbookCount === visibleTextbookIds.length;
  const someVisibleTextbooksSelected = selectedVisibleTextbookCount > 0 && !allVisibleTextbooksSelected;
  const hasTextbookListFilter =
    Boolean(query) ||
    activeTextbookQualityFilter !== "all" ||
    subjectGroupFilter !== "all" ||
    schoolLevelGroupFilter !== "all" ||
    gradeLevelGroupFilter !== "all" ||
    categoryGroupFilter !== "all";
  const textbookEmptyLabel = hasTextbookListFilter ? "조건에 맞는 교재가 없습니다" : "교재가 없습니다";
  useEffect(() => {
    if (activeTab !== "master") return;
    const availableIds = new Set(filteredInventory.map(getRecordId).filter(Boolean));
    setSelectedTextbookIds((current) => {
      const next = current.filter((id) => availableIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [activeTab, filteredInventory]);

  const masterDuplicateRows = acceptedMasterDuplicate?.previewRows || [];
  const masterDuplicateTotalCount = acceptedMasterDuplicate?.totalCount || 0;

  useEffect(() => {
    if (activeTab !== "requests" && activeTab !== "purchase") return;
    const preparedRows = activeTab === "requests" ? numbered.requests.rows : numbered.purchase.rows;
    const existingIds = new Set(preparedRows.flatMap((row) => row.memberLineIds));
    setSelectedPurchaseLineIds((current) => {
      const next = current.filter((id) => existingIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [activeTab, numbered.purchase.rows, numbered.requests.rows]);

  useEffect(() => {
    if (activeTab !== "sales") return;
    const existingIds = new Set(numbered.sales.rows.map((row) => row.id));
    setSelectedSaleLineIds((current) => {
      const next = current.filter((id) => existingIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [activeTab, numbered.sales.rows]);

  useEffect(() => {
    if (!canManageTextbookOperations && activeTab !== "requests") {
      setActiveTab("requests");
      updateOperationSearchQuery("");
      setSelectedPurchaseLineIds([]);
      setSelectedSaleLineIds([]);
      setSelectedTextbookIds([]);
    }
  }, [activeTab, canManageTextbookOperations]);

  useEffect(() => {
    if (gradeLevelGroupFilter === "all") return;
    if (gradeLevelGroupOptions.some((option) => option.value === gradeLevelGroupFilter)) return;
    setGradeLevelGroupFilter("all");
  }, [gradeLevelGroupFilter, gradeLevelGroupOptions]);

  useEffect(() => {
    if (!acceptedMasterOptions) return;
    if (categoryGroupFilter === "all") return;
    if (categoryGroupOptions.includes(categoryGroupFilter)) return;
    setCategoryGroupFilter("all");
  }, [acceptedMasterOptions, categoryGroupFilter, categoryGroupOptions]);

  const preparedPurchaseRows = useMemo(() => [...numbered.requests.rows, ...numbered.purchase.rows], [numbered.purchase.rows, numbered.requests.rows]);
  const purchaseOrdersById = useMemo(() => new Map<string, Row>(preparedPurchaseRows.flatMap((row) => row.lines.map((line) => line.order).filter(Boolean) as Row[]).map((order) => [getRecordId(order), order])), [preparedPurchaseRows]);
  const purchaseLinesById = useMemo(() => new Map<string, Row>(preparedPurchaseRows.flatMap((row) => row.lines as Row[]).map((line) => [getRecordId(line), line])), [preparedPurchaseRows]);
  const saleLinesById = useMemo(() => new Map<string, Row>(numbered.sales.rows.map((row) => [row.id, row.line as Row])), [numbered.sales.rows]);
  const selectedBulkOrderLines = useMemo(
    () => selectedPurchaseLineIds
      .map((id) => purchaseLinesById.get(id))
      .filter((line): line is Row => {
        if (!line) return false;
        const order = getPurchaseLineOrder(line, purchaseOrdersById);
        if (text(line.status || order?.status) !== "requested") return false;
        return Boolean(preparedPurchaseRows.find((row) => row.memberLineIds.includes(getRecordId(line)))?.references.textbook);
      }),
    [preparedPurchaseRows, purchaseLinesById, purchaseOrdersById, selectedPurchaseLineIds],
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
  const selectedBookReference = acceptedSelectedBook;
  const explicitlySelectedPurchaseTextbook = purchaseDialogOpen ? selectedBookReference?.textbook : undefined;
  const explicitPurchaseTextbookId = getRecordId(explicitlySelectedPurchaseTextbook || {});
  const purchaseRequestTitle = purchaseRequestInputMode === "manual"
    ? normalizeStoredTextInput(purchaseForm.requestedTextbookTitle)
    : explicitPurchaseTextbookId === purchaseForm.textbookId ? getTextbookTitle(explicitlySelectedPurchaseTextbook || {}) : "";
  const selectedPurchaseTextbook = explicitlySelectedPurchaseTextbook;
  const selectedPurchaseTextbookId = getRecordId(selectedPurchaseTextbook || {});
  const purchaseRequestUsesCatalog = purchaseRequestInputMode === "catalog";
  const manualPurchaseCatalogMatches = useMemo(
    () => {
      if (purchaseRequestInputMode !== "manual") return [];
      const textbook = selectedBookReference?.textbook && getTextbookTitle(selectedBookReference.textbook) === purchaseRequestTitle
        ? selectedBookReference.textbook : undefined;
      return textbook ? [textbook] : [];
    },
    [purchaseRequestInputMode, purchaseRequestTitle, selectedBookReference],
  );
  const hasManualPurchaseCatalogMatch = manualPurchaseCatalogMatches.length > 0;
  const configuredPurchaseSupplierId =
    selectedBookReference?.configuredSupplierId || purchaseForm.supplierId;
  const selectedPurchaseSupplierRows = selectedBookReference?.supplier ? [selectedBookReference.supplier] : [];
  const purchaseCopyScope = getTextbookCopyScope(purchaseForm);
  const configuredPurchaseUnitCost = getConfiguredTextbookPurchaseUnitCost(
    selectedPurchaseTextbook,
    configuredPurchaseSupplierId,
    selectedPurchaseSupplierRows,
    purchaseForm.unitCost,
    purchaseCopyScope,
  );
  const configuredPurchaseSupplierLabel = configuredPurchaseSupplierId
    ? selectedBookReference?.supplier?.name || configuredPurchaseSupplierId
    : "-";
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
  const selectedPurchaseBalance = acceptedPurchaseBalance?.rows.find((row) => row.textbookId === purchaseForm.textbookId);
  const purchaseCurrentLocationQuantity = selectedPurchaseBalance?.currentQuantity || 0;
  const purchaseProjectedLocationQuantity = purchaseForm.requestStage === "receive"
    ? purchaseCurrentLocationQuantity + purchaseReceivedTotalQuantity
    : purchaseCurrentLocationQuantity;
  const configuredPurchaseStudentUnitCost = getConfiguredTextbookPurchaseUnitCost(
    selectedPurchaseTextbook,
    configuredPurchaseSupplierId,
    selectedPurchaseSupplierRows,
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
  const saleCopyScope = getTextbookCopyScope(saleForm);
  const isTeacherSale = saleCopyScope === "teacher";
  const classSaleContext = !isTeacherSale ? acceptedClassSalePreview : null;
  const selectedSaleClass = classSaleContext?.class;
  const selectedSaleTextbook = saleDialogOpen ? selectedBookReference?.textbook : undefined;
  const teacherBalance = acceptedTeacherSaleBalance?.rows.find((row) => row.textbookId === saleForm.textbookId);
  const saleAvailableQuantity = isTeacherSale ? teacherBalance?.currentQuantity || 0 : classSaleContext?.inventory.currentQuantity || 0;
  const saleTeacherName = text(saleForm.teacherName);
  const saleTeacherQuantity = Math.max(1, numberValue(saleForm.quantity) || 1);
  const selectedClassStudents = useMemo(() => classSaleContext?.enrolledStudentIds.map((studentId) =>
    classSaleContext.students.find((student) => student.id === studentId) || { id: studentId, name: studentId, grade: null, school: null }) || [], [classSaleContext]);
  const normalizedSaleChargeMonth = normalizeMonthInput(saleForm.chargeMonth);
  const saleStudentSearchQuery = normalizeStoredTextInput(saleStudentQuery).toLowerCase();
  const visibleSaleStudents = useMemo(
    () => {
      if (!saleStudentSearchQuery) return selectedClassStudents;
      return selectedClassStudents.filter((student) =>
        [
          getStudentName(student),
          getStudentGradeLabel(student),
          text(student.school),
        ].join(" ").toLowerCase().includes(saleStudentSearchQuery),
      );
    },
    [saleStudentSearchQuery, selectedClassStudents],
  );
  const saleDuplicateLines = useMemo(() => classSaleContext?.duplicateLines || [], [classSaleContext]);
  const saleDuplicateStudentCount = useMemo(
    () => new Set(saleDuplicateLines.map((line) => text(line.student_id)).filter(Boolean)).size || saleDuplicateLines.length,
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
  const classSalePreviewAccepted = Boolean(acceptedClassSalePreview);
  const teacherSalePreviewAccepted = Boolean(acceptedTeacherSaleBalance);
  const saleReferencesAccepted = Boolean(selectedSaleTextbook
    && acceptedSelectedLocation?.id === saleLocationId
    && (isTeacherSale || acceptedSelectedClass?.id === saleForm.classId));
  const saleSubmitDisabled = schemaDisabled || (isTeacherSale
    ? !saleReferencesAccepted || !saleTeacherName || saleTeacherQuantity <= 0 || !teacherSalePreviewAccepted
    : !saleReferencesAccepted || !selectedSaleClass ||
      !classSalePreviewAccepted ||
      saleDraft.lines.length === 0 ||
      saleDuplicateLines.length > 0);
  const effectiveSaleSubmitHint = schemaDisabled ? "교재 정보를 다시 불러온 뒤 저장하세요."
    : !saleForm.textbookId ? "교재를 선택하세요."
    : isTeacherSale && !saleTeacherName ? "선생님을 선택하세요."
    : !isTeacherSale && !saleForm.classId ? "수업을 선택하세요."
    : !saleLocationId ? "위치를 선택하세요."
    : saleReferenceError ? "조회 오류를 해결한 뒤 저장하세요."
    : !saleReferencesAccepted || (isTeacherSale ? !teacherSalePreviewAccepted : !classSalePreviewAccepted) ? "선택한 대상과 재고를 확인하고 있습니다."
    : saleDuplicateLines.length > 0 ? "이미 같은 월 출고가 있습니다."
    : !isTeacherSale && saleDraft.lines.length === 0 ? "출고 대상 학생을 선택하세요."
    : "";
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
  const operationMetrics = numbered.operations.value || {
    requestCount: 0, unregisteredRequestCount: 0, orderNeededCount: 0, receivingBacklogCount: 0, partialReceiptCount: 0, issueWaitingCount: 0, stockRiskCount: 0,
  };
  const showsProcessToolbar = activeTab === "requests" || activeTab === "purchase" || activeTab === "sales";
  const operationSearchLabel = getOperationSearchLabel(activeTab);
  const operationSearchPlaceholder = getOperationSearchPlaceholder(activeTab);
  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        if (document.activeElement === masterSearchRef.current && query) {
          event.preventDefault();
          setQuery("");
          setSelectedTextbookIds([]);
          setBulkTextbookPatch(emptyBulkTextbookPatch);
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

  const masterGradeOptions = TEXTBOOK_GRADE_OPTIONS.filter((option) =>
    masterForm.schoolLevels.includes(option.schoolLevel),
  );
  const masterSubSubjectOptions = getSubSubjectOptionsForSubject(textbookSubSubjectSettings, masterForm.subject);
  const masterTitleValue = text(masterForm.title);
  const masterDuplicatePreviewRows = masterDuplicateRows.slice(0, 3);
  const isNewMasterDuplicate = !masterForm.id && masterDuplicateTotalCount > 0;
  const masterDuplicateAccepted = Boolean(acceptedMasterDuplicate);
  const bulkCategoryOptions = acceptedMasterOptions?.bulkCategoryOptions || [];
  const masterOptionsAccepted = Boolean(acceptedMasterOptions);
  const masterTaxonomyValidation = validateTextbookTaxonomyForWrite(masterForm);
  const masterSubmitDisabled = schemaDisabled || saving === "master" || !masterTitleValue || !masterTaxonomyValidation.valid || isNewMasterDuplicate
    || !masterOptionsAccepted || referenceData.masterDuplicate.loading || Boolean(referenceData.masterDuplicate.error) || !masterDuplicateAccepted;
  const masterSubmitHint = referenceData.masterOptions.error || referenceData.masterDuplicate.error ? "조회 오류를 해결한 뒤 저장하세요."
    : schemaDisabled ? "교재 정보를 다시 불러온 뒤 저장하세요."
    : !masterTitleValue ? "교재명을 입력하세요."
    : !masterTaxonomyValidation.valid ? masterTaxonomyValidation.message
    : isNewMasterDuplicate ? "이미 등록된 교재입니다. 기존 교재를 열어 수정하세요."
    : !masterOptionsAccepted || !masterDuplicateAccepted || referenceData.masterDuplicate.loading ? "교재 분류와 중복 여부를 확인하고 있습니다."
    : "";
  const purchaseBookAccepted = purchaseRequestInputMode === "manual" && purchaseForm.requestStage === "request"
    ? true : Boolean(acceptedSelectedBook && getRecordId(acceptedSelectedBook.textbook) === purchaseForm.textbookId);
  const purchaseClassAccepted = !purchaseForm.classId || acceptedSelectedClass?.id === purchaseForm.classId;
  const purchaseLocationAccepted = Boolean(purchaseForm.locationId && acceptedSelectedLocation?.id === purchaseForm.locationId);
  const purchaseBalanceAccepted = purchaseForm.requestStage === "request" || Boolean(acceptedPurchaseBalance);
  const purchaseSubmitDisabled = schemaDisabled ||
    saving === "purchase" ||
    !purchaseBookAccepted || !purchaseClassAccepted || !purchaseLocationAccepted || !purchaseBalanceAccepted ||
    (purchaseForm.requestStage === "request" && !purchaseRequestTitle) ||
    (purchaseForm.requestStage !== "request" && !selectedPurchaseTextbookId) ||
    (purchaseForm.requestStage === "request" && !purchaseRequestedTotalQuantity && !selectedPurchaseLineId) ||
    (purchaseForm.requestStage !== "request" && !purchaseOrderedTotalQuantity) ||
    (purchaseForm.requestStage === "receive" && !purchaseReceivedTotalQuantity);
  const purchaseSubmitHint = schemaDisabled ? "교재 정보를 다시 불러온 뒤 저장하세요."
    : !purchaseRequestTitle ? (purchaseForm.requestStage === "request" ? "교재를 선택하거나 교재명을 입력하세요." : "교재를 선택하세요.")
    : !purchaseForm.locationId ? "위치를 선택하세요."
    : purchaseReferenceError ? "조회 오류를 해결한 뒤 저장하세요."
    : !purchaseBookAccepted || !purchaseClassAccepted || !purchaseLocationAccepted || !purchaseBalanceAccepted ? "선택한 교재와 위치를 확인하고 있습니다."
    : purchaseForm.requestStage === "request" && !purchaseRequestedTotalQuantity && !selectedPurchaseLineId ? "요청 수량을 입력하세요."
    : purchaseForm.requestStage !== "request" && !purchaseOrderedTotalQuantity ? "주문 수량을 입력하세요."
    : purchaseForm.requestStage === "receive" && !purchaseReceivedTotalQuantity ? "입고 수량을 입력하세요."
    : "";
  function setPurchaseField(name: string, value: string) {
    setPurchaseForm((current) => {
      if (name === "textbookId") {
        return {
          ...current,
          textbookId: value,
          requestedTextbookTitle: value ? current.requestedTextbookTitle : "",
        };
      }

      if (name === "classId") {
        return {
          ...current,
          classId: value,
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
    void Promise.all([activePrimaryState.retry(), activeSummaryResource?.retry()]);
  }

  function setMasterTextField(name: "title" | "publisher", value: string) {
    setMasterForm((current) => ({ ...current, [name]: normalizeInlineTextInput(value) }));
  }

  function settleMasterTextField(name: "title" | "publisher") {
    setMasterForm((current) => ({ ...current, [name]: normalizeStoredTextInput(current[name]) }));
  }

  function navigateToTextbookDetail(kind: "master" | "purchase" | "sale", id: string) {
    requestLocalAction(() => {
      if (!isTextbookUuid(id)) return;
      const current = new URLSearchParams(window.location.search);
      const parsed = parseTextbookNavigation(current);
      const next = serializeTextbookNavigation(current, { ...parsed, detail: { kind, id } });
      pushLocalHistoryState(window, null, "", `${window.location.pathname}?${next.toString()}`);
      adoptLocationQuery(next.toString());
    }, { skipConfirmation: !(queryResetDraftDirty) });
  }

  function closeTextbookDetail(kind: "master" | "purchase" | "sale") {
    const current = new URLSearchParams(window.location.search);
    const parsed = parseTextbookNavigation(current);
    if (parsed.detail?.kind !== kind) return;
    const next = serializeTextbookNavigation(current, { ...parsed, detail: null });
    window.history.replaceState(null, "", `${window.location.pathname}?${next.toString()}`);
    adoptLocationQuery(next.toString());
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
    requestLocalAction(() => {
      clearTransientTextbookFeedback();
      replaceMasterForm(emptyMasterForm);
      setMessage("");
      setMasterDialogOpen(true);
    }, { skipConfirmation: !(masterDraftDirty) });
  }

  function selectMasterTextbook(row: Row) {
    clearTransientTextbookFeedback();
    const rowId = getRecordId(row);
    if (masterDraftDirty && masterForm.id === rowId) return;
    if (rowId !== selectedMasterDetailId) {
      navigateToTextbookDetail("master", rowId);
      return;
    }
    const taxonomy = getTextbookTaxonomySelection(row);
    replaceMasterForm({
      id: getRecordId(row),
      title: getTextbookTitle(row),
      subject: getTextbookSubjectWriteValue(row.subject),
      subjectAreaKey: getTextbookSubjectAreaKey(row),
      schoolLevels: taxonomy.schoolLevels,
      gradeLevels: taxonomy.gradeLevels,
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
    requestLocalAction(() => {
      clearTransientTextbookFeedback();
      const prepared = preparedPurchaseRows.find((row) => row.memberLineIds.includes(getRecordId(line)));
      const title = getPurchaseTextbookTitle(line, prepared?.references.textbook || undefined);
      const taxonomy = getTextbookTaxonomySelection(line);
      replaceMasterForm({
        ...emptyMasterForm,
        title: title === "-" ? "" : title,
        subject: getTextbookSubjectWriteValue(line.subject),
        subjectAreaKey: getTextbookSubjectAreaKey(line),
        schoolLevels: taxonomy.schoolLevels,
        gradeLevels: taxonomy.gradeLevels,
        subSubject: getTextbookSubSubject(line),
      });
      setMasterDialogOpen(true);
      setMessage("");
    }, { skipConfirmation: !(masterDraftDirty) });
  }

  function resetPurchaseForm() {
    purchaseAutoDefaultsRef.current = { title: "", supplierId: "", unitCost: "", requestBy: "", locationId: "" };
    setSelectedPurchaseLineId("");
    setSelectedPurchaseScopeLineIds({ student: "", teacher: "" });
    replacePurchaseForm(emptyPurchaseForm);
    setPurchaseRequestInputMode("catalog");
    setMessage("");
  }

  function resetSaleForm() {
    saleAutoDefaultsRef.current = { locationId: "" };
    replaceSaleForm({ ...emptySaleForm, chargeMonth: currentMonth() });
    setExcludedStudentIds([]);
    setSaleStudentQuery("");
  }

  function openNewPurchaseDialog() {
    requestLocalAction(() => {
      clearTransientTextbookFeedback();
      setSelectedPurchaseLineId("");
      setSelectedPurchaseScopeLineIds({ student: "", teacher: "" });
      replacePurchaseForm({ ...emptyPurchaseForm, requestStage: "order" });
      setPurchaseRequestInputMode("catalog");
      setMessage("");
      setPurchaseDialogOpen(true);
    }, { skipConfirmation: !(purchaseDraftDirty) });
  }

  function openNewRequestDialog() {
    requestLocalAction(() => {
      clearTransientTextbookFeedback();
      setSelectedPurchaseLineId("");
      setSelectedPurchaseScopeLineIds({ student: "", teacher: "" });
      replacePurchaseForm({ ...emptyPurchaseForm, requestStage: "request", requestBy: currentUserLabel });
      setPurchaseRequestInputMode("catalog");
      setMessage("");
      setPurchaseDialogOpen(true);
    }, { skipConfirmation: !(purchaseDraftDirty) });
  }

  function openNewSaleDialog() {
    requestLocalAction(() => {
      clearTransientTextbookFeedback();
      resetSaleForm();
      setMessage("");
      setSaleDialogOpen(true);
    }, { skipConfirmation: !(saleDraftDirty) });
  }

  function closeMasterDialog() {
    requestLocalAction(() => {
      clearTransientTextbookFeedback();
      setMasterDialogOpen(false);
      replaceMasterForm(emptyMasterForm);
      setMessage("");
      closeTextbookDetail("master");
      window.setTimeout(() => setMasterDialogOpen(false), 0);
    }, { skipConfirmation: !(masterDraftDirty) });
  }

  function closePurchaseDialog() {
    requestLocalAction(() => {
      clearTransientTextbookFeedback();
      setPurchaseDialogOpen(false);
      resetPurchaseForm();
      closeTextbookDetail("purchase");
      window.setTimeout(() => setPurchaseDialogOpen(false), 0);
    }, { skipConfirmation: !(purchaseDraftDirty) });
  }

  function closeSaleDialog() {
    requestLocalAction(() => {
      clearTransientTextbookFeedback();
      setSaleDialogOpen(false);
      resetSaleForm();
      setMessage("");
      window.setTimeout(() => setSaleDialogOpen(false), 0);
    }, { skipConfirmation: !(saleDraftDirty) });
  }

  function clearMasterSelection() {
    updateTextbookSelectionIntent(() => []);
    setBulkTextbookPatch(emptyBulkTextbookPatch);
  }

  function openMasterBulkDialog() {
    masterBulkDialogRevisionRef.current += 1;
    clearTransientTextbookFeedback();
    setMasterBulkControlsOpen(true);
  }

  function closeMasterBulkDialog() {
    requestLocalAction(() => {
      masterBulkDialogRevisionRef.current += 1;
      clearTransientTextbookFeedback();
      setMasterBulkControlsOpen(false);
      setBulkTextbookPatch(emptyBulkTextbookPatch);
    }, { skipConfirmation: !(masterBulkDraftDirty) });
  }

  function clearTransientTextbookFeedback() {
    setMessage("");
    setActionErrorMessage("");
    setActionErrorOwner("");
  }

  function updateMasterSearchQuery(value: string) {
    requestLocalAction(() => {
      clearTransientTextbookFeedback();
      setQuery(value);
      clearMasterSelection();
    }, { skipConfirmation: !(masterBulkDraftDirty) });
  }

  function changeTextbookQualityFilter(value: "all" | "inactive") {
    requestLocalAction(() => {
      clearTransientTextbookFeedback();
      setTextbookQualityFilter(value);
      clearMasterSelection();
    }, { skipConfirmation: !(masterBulkDraftDirty) });
  }

  function changeSubjectGroupFilter(value: string) {
    requestLocalAction(() => {
      clearTransientTextbookFeedback();
      setSubjectGroupFilter(value);
      setCategoryGroupFilter("all");
      clearMasterSelection();
    }, { skipConfirmation: !(masterBulkDraftDirty) });
  }

  function changeSchoolLevelGroupFilter(value: string) {
    requestLocalAction(() => {
      clearTransientTextbookFeedback();
      setSchoolLevelGroupFilter(value);
      setGradeLevelGroupFilter("all");
      clearMasterSelection();
    }, { skipConfirmation: !(masterBulkDraftDirty) });
  }

  function changeGradeLevelGroupFilter(value: string) {
    requestLocalAction(() => {
      clearTransientTextbookFeedback();
      setGradeLevelGroupFilter(value);
      clearMasterSelection();
    }, { skipConfirmation: !(masterBulkDraftDirty) });
  }

  function changeCategoryGroupFilter(value: string) {
    requestLocalAction(() => {
      clearTransientTextbookFeedback();
      setCategoryGroupFilter(value);
      clearMasterSelection();
    }, { skipConfirmation: !(masterBulkDraftDirty) });
  }

  function requestTextbookConfirmation(request: TextbookConfirmationRequest) {
    clearTransientTextbookFeedback();
    setConfirmationError("");
    setConfirmationRequest(request);
  }

  function confirmTextbookAction() {
    const request = confirmationRequest;
    if (request) void executeTextbookConfirmation(request.onConfirm, () => setConfirmationRequest(null));
  }

  function closeTextbookConfirmation() {
    if (confirmationPendingRef.current) return;
    clearTransientTextbookFeedback();
    setConfirmationError("");
    setConfirmationRequest(null);
    setTextbookDeleteDialogOpen(false);
  }

  async function executeTextbookConfirmation(action: () => Promise<boolean>, onSuccess: () => void) {
    if (confirmationPendingRef.current) return;
    const expectedActorKey = actorKey;
    confirmationPendingRef.current = true;
    setConfirmationBusy(true);
    setConfirmationError("");
    clearTransientTextbookFeedback();
    try {
      const ok = await action();
      if (!isCurrentActionActor(expectedActorKey)) return;
      if (ok) {
        dialogOpenerRef.current = activeTab === "master" || activeTab === "inventory" ? masterSearchRef.current : operationSearchRef.current;
        onSuccess();
      } else {
        setConfirmationError("처리하지 못했습니다. 대상을 확인한 뒤 다시 시도하세요.");
      }
    } catch (error) {
      if (isCurrentActionActor(expectedActorKey)) setConfirmationError(getTextbookActionErrorMessage(error));
    } finally {
      confirmationPendingRef.current = false;
      if (isCurrentActionActor(expectedActorKey)) setConfirmationBusy(false);
    }
  }

  function changeActiveTab(value: string) {
    requestLocalAction(() => {
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
        const params = new URLSearchParams(window.location.search);
        params.set("textbookTab", value);
        params.set("textbookPage", "1");
        params.delete("textbookFilters");
        const queryString = params.toString();
        pushLocalHistoryState(window, null, "", `${window.location.pathname}?${queryString}`);
        adoptLocationQuery(queryString);
      }
      setActiveTab(value as TextbookTab);
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
    }, { skipConfirmation: !(value !== activeTab && queryResetDraftDirty) });
  }

  function clearTextbookListFilters(nextQuery = "") {
    clearTransientTextbookFeedback();
    setQuery(nextQuery);
    clearMasterSelection();
    setTextbookQualityFilter("all");
    setSubjectGroupFilter("all");
    setSchoolLevelGroupFilter("all");
    setGradeLevelGroupFilter("all");
    setCategoryGroupFilter("all");
    setCollapsedTextbookGroups([]);
    clearMasterSelection();
  }

  function resetTextbookListFilters() {
    requestLocalAction(() => {
      clearTextbookListFilters("");
    }, { skipConfirmation: !(masterBulkDraftDirty) });
  }

  function showSavedMasterTextbook(title: string) {
    setActiveTab("master");
    updateOperationSearchQuery("");
    clearTextbookListFilters(title);
    window.setTimeout(() => masterSearchRef.current?.select(), 0);
  }

  function showSavedPurchaseFlow(stage: string, title: string, hasCatalogTextbook: boolean) {
    setActiveTab(canManageTextbookOperations ? "purchase" : "requests");
    updateOperationSearchQuery(title);
    setPurchaseBoardScope(getSavedPurchaseBoardScope(stage));
    setPurchaseRequestFilter(canManageTextbookOperations ? getSavedPurchaseRequestFilter(stage, hasCatalogTextbook) : "all");
    setPurchaseOrderFilter(getSavedPurchaseOrderFilter(stage, hasCatalogTextbook));
    window.setTimeout(() => operationSearchRef.current?.select(), 0);
  }

  function toggleTextbookGroup(label: string) {
    setCollapsedTextbookGroups((current) =>
      current.includes(label) ? current.filter((item) => item !== label) : [...current, label],
    );
  }

  function updateTextbookSelectionIntent(update: (current: string[]) => string[]) {
    setSelectedTextbookIds((current) => {
      const next = update(current);
      const currentIds = new Set(current);
      const nextIds = new Set(next);
      for (const id of new Set([...currentIds, ...nextIds])) {
        if (currentIds.has(id) !== nextIds.has(id)) {
          textbookSelectionRevisionsRef.current[id] = (textbookSelectionRevisionsRef.current[id] || 0) + 1;
        }
      }
      return next;
    });
  }

  function toggleTextbookSelection(id: string, checked: boolean) {
    updateTextbookSelectionIntent((current) => {
      if (!id) return current;
      if (checked) {
        return current.includes(id) ? current : [...current, id];
      }
      return current.filter((item) => item !== id);
    });
  }

  function toggleAllVisibleTextbooks(checked: boolean) {
    updateTextbookSelectionIntent((current) => {
      if (!checked) {
        return current.filter((id) => !visibleTextbookIdSet.has(id));
      }
      return [...new Set([...current, ...visibleTextbookIds])];
    });
  }

  function toggleVisibleTextbookIds(ids: string[], checked: boolean) {
    updateTextbookSelectionIntent((current) => {
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

  function openBulkOrderDialog() {
    clearTransientTextbookFeedback();
    if (selectedBulkOrderLines.length === 0) {
      return;
    }

    replaceBulkOrderQuantities(Object.fromEntries(selectedBulkOrderLines.map((line) => {
      const order = getPurchaseLineOrder(line, purchaseOrdersById);
      const draft = buildPurchaseCardDraft(line, order);
      return [getRecordId(line), getPositivePurchaseQuantityText(draft.orderedQuantity) || draft.requestedQuantity || "1"];
    })));
    setBulkOrderDialogOpen(true);
    setMessage("");
  }

  async function readFreshPurchaseMembers(lines: Row[], mode: "request" | "order", expectedSelection?: string) {
    const expectedActorKey = actorKey;
    const anchors = [...new Set(lines.map((line) => {
      const prepared = preparedPurchaseRows.find((row) => row.memberLineIds.includes(getRecordId(line)));
      return prepared?.anchorLineId || getRecordId(line);
    }).filter(Boolean))];
    const details = await Promise.all(anchors.map((anchorLineId) => getTextbookPurchaseDetail({ anchorLineId, mode })));
    assertLivePreparedSchemaReady();
    if (!isCurrentActionActor(expectedActorKey) || (expectedSelection !== undefined && liveActionInputsRef.current.purchaseSelection !== expectedSelection)) {
      throw new Error("작업 대상이 변경되었습니다. 다시 시도하세요.");
    }
    if (details.some((detail) => !detail.row)) throw new Error("구매 작업 대상을 찾을 수 없습니다.");
    return details.map((detail) => detail.row as TextbookPurchaseCaseRow);
  }

  function closeBulkOrderDialog() {
    requestLocalAction(() => {
      clearTransientTextbookFeedback();
      setBulkOrderDialogOpen(false);
      replaceBulkOrderQuantities({});
      setMessage("");
      window.setTimeout(() => setBulkOrderDialogOpen(false), 0);
    }, { skipConfirmation: !(bulkOrderDraftDirty) });
  }

  function setBulkOrderQuantity(lineId: string, value: string) {
    setBulkOrderQuantities((current) => ({ ...current, [lineId]: value }));
  }

  function applyConfiguredPurchasePricingToPayload(payload: Row, references?: TextbookPurchaseCaseRow["references"]) {
    const prepared = preparedPurchaseRows.find((row) => row.memberLineIds.includes(text(payload.purchaseOrderLineId))
      || getRecordId(row.references.textbook || {}) === text(payload.textbookId));
    const textbook = references?.textbook || prepared?.references.textbook || (acceptedSelectedBook?.textbook as Row | undefined);
    const supplierId = references?.configuredSupplierId || prepared?.references.configuredSupplierId || acceptedSelectedBook?.configuredSupplierId || text(payload.supplierId);
    const supplierRows = [references?.supplier, prepared?.references.supplier, acceptedSelectedBook?.supplier].filter(Boolean) as Row[];

    return {
      ...payload,
      textbookId: getRecordId(textbook || {}) || text(payload.textbookId),
      supplierId,
      unitCost: String(getConfiguredTextbookPurchaseUnitCost(textbook, supplierId, supplierRows, payload.unitCost, getTextbookCopyScope(payload))),
    };
  }

  function getPurchaseLineTextbookId(line: Row, references?: TextbookPurchaseCaseRow["references"]) {
    const textbook = references?.textbook || preparedPurchaseRows.find((row) => row.memberLineIds.includes(getRecordId(line)))?.references.textbook;
    return getRecordId(textbook || {}) || text(line.textbook_id || line.textbookId);
  }

  function submitBulkOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedBulkOrderLines.length === 0) {
      return;
    }

    const expectedSelection = JSON.stringify(selectedPurchaseLineIds);
    const expectedBulkOrder = JSON.stringify({ selection: selectedPurchaseLineIds, quantities: bulkOrderQuantities });
    const isCurrentBulkOrder = () => liveActionInputsRef.current.purchaseSelection === expectedSelection
      && liveActionInputsRef.current.bulkOrder === expectedBulkOrder;
    void runAction(
      "purchase-bulk-order",
      async () => {
        const details = await readFreshPurchaseMembers(selectedBulkOrderLines, "request", expectedSelection);
        if (!isCurrentBulkOrder()) throw new Error("주문 입력이 변경되었습니다. 다시 시도하세요.");
        const actualLines = details.flatMap((detail) => detail.lines.map((line) => ({ line, references: detail.references }))).filter(({ line }) => selectedPurchaseLineIds.includes(getRecordId(line)));
        if (actualLines.length !== selectedPurchaseLineIds.length) throw new Error("선택한 모든 구매 작업 대상을 찾을 수 없습니다.");
        for (const { line, references } of actualLines) {
          const order = (line.order as Row | null) || undefined;
          const draft = buildPurchaseCardDraft(line, order);
          const lineId = getRecordId(line);
          const orderedQuantity = normalizeQuantityInput(bulkOrderQuantities[lineId]) || getPositivePurchaseQuantityText(draft.orderedQuantity) || draft.requestedQuantity || "1";
          await textbookService.updatePurchaseLifecycle({
            ...applyConfiguredPurchasePricingToPayload(buildPurchasePayloadFromDraft(
              line,
              order,
              {
                ...draft,
                orderedQuantity,
              },
              "ordered",
            ), references),
            createdBy: currentUserId,
          });
        }
      },
      `${formatQuantity(selectedBulkOrderLines.length)}건을 주문으로 전환했습니다.`,
      invalidatePurchase,
      isCurrentBulkOrder,
    ).then((ok) => {
      if (ok) {
        setSelectedPurchaseLineIds([]);
        replaceBulkOrderQuantities({});
        setBulkOrderDialogOpen(false);
      }
    });
  }

  function receiveSelectedPurchaseLines() {
    if (selectedReceivablePurchaseLines.length === 0) {
      return;
    }

    const expectedSelection = JSON.stringify(selectedPurchaseLineIds);
    const isCurrentSelection = () => liveActionInputsRef.current.purchaseSelection === expectedSelection;
    void runAction(
      "purchase-bulk-receive",
      async () => {
        const details = await readFreshPurchaseMembers(selectedReceivablePurchaseLines, "order", expectedSelection);
        const actualLines = details.flatMap((detail) => detail.lines.map((line) => ({ line, references: detail.references }))).filter(({ line }) => selectedPurchaseLineIds.includes(getRecordId(line)));
        if (actualLines.length !== selectedPurchaseLineIds.length) throw new Error("선택한 모든 구매 작업 대상을 찾을 수 없습니다.");
        for (const { line, references } of actualLines) {
          const order = (line.order as Row | null) || undefined;
          const draft = buildPurchaseCardDraft(line, order);
          const orderedQuantity = draft.orderedQuantity || draft.requestedQuantity || "1";
          await textbookService.updatePurchaseLifecycle({
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
            ), references),
            createdBy: currentUserId,
          });
        }
      },
      `${formatQuantity(selectedReceivablePurchaseLines.length)}건을 입고 완료했습니다.`,
      invalidatePurchase,
      isCurrentSelection,
    ).then((ok) => { if (ok) setSelectedPurchaseLineIds([]); });
  }

  function setBulkTextbookPatchField(name: keyof typeof emptyBulkTextbookPatch, value: string) {
    setBulkTextbookPatch((current) => {
      if (name === "subject") {
        if (value === "science") {
          return {
            ...current,
            subject: value,
            subjectAreaKey: "",
            category: "",
            schoolLevels: [...SCIENCE_TEXTBOOK_TAXONOMY.schoolLevels],
            gradeLevels: [...SCIENCE_TEXTBOOK_TAXONOMY.gradeLevels],
          };
        }
        const nextCategory = value === "keep" || getSubSubjectOptionsForSubject(textbookSubSubjectSettings, value).includes(current.category)
          ? current.category
          : "";
        return { ...current, subject: value, subjectAreaKey: "", category: nextCategory };
      }

      if (name === "subjectAreaKey") {
        const category = scienceSubjectAreaOptions.find((option) => option.value === value)?.label || "";
        return { ...current, subjectAreaKey: value, category };
      }

      return { ...current, [name]: value };
    });
  }

  function setBulkTextbookTaxonomyEnabled(enabled: boolean) {
    setBulkTextbookPatch((current) => ({
      ...current,
      schoolLevels: current.subject === "science"
        ? [...SCIENCE_TEXTBOOK_TAXONOMY.schoolLevels]
        : enabled ? [] : null,
      gradeLevels: current.subject === "science"
        ? [...SCIENCE_TEXTBOOK_TAXONOMY.gradeLevels]
        : enabled ? [] : null,
    }));
  }

  function toggleBulkTextbookSchoolLevel(value: TextbookSchoolLevel, checked: boolean) {
    setBulkTextbookPatch((current) => {
      if (current.subject === "science") return current;
      if (current.schoolLevels === null || current.gradeLevels === null) return current;
      const next = toggleTextbookSchoolLevel(
        {
          schoolLevels: current.schoolLevels as TextbookSchoolLevel[],
          gradeLevels: current.gradeLevels as TextbookGradeLevel[],
        },
        value,
        checked,
      );
      return { ...current, ...next };
    });
  }

  function toggleBulkTextbookGradeLevel(value: TextbookGradeLevel, checked: boolean) {
    setBulkTextbookPatch((current) => {
      if (current.subject === "science") return current;
      if (current.schoolLevels === null || current.gradeLevels === null) return current;
      const next = toggleTextbookGradeLevel(
        {
          schoolLevels: current.schoolLevels as TextbookSchoolLevel[],
          gradeLevels: current.gradeLevels as TextbookGradeLevel[],
        },
        value,
        checked,
      );
      return { ...current, ...next };
    });
  }

  function hasBulkTextbookPatchValues() {
    return bulkTextbookPatch.subject !== "keep" ||
      Boolean(bulkTextbookPatch.subjectAreaKey) ||
      bulkTextbookPatch.schoolLevels !== null ||
      bulkTextbookPatch.gradeLevels !== null ||
      text(bulkTextbookPatch.category) ||
      text(bulkTextbookPatch.publisher) ||
      text(bulkTextbookPatch.price) ||
      bulkTextbookPatch.status !== "keep";
  }

  function getBulkTextbookPatchValues(row: Row, patchInput = bulkTextbookPatch) {
    const patch: Row = {};
    if (patchInput.subject !== "keep") patch.subject = patchInput.subject;
    if (patchInput.subject === "science") {
      patch.subjectAreaKey = patchInput.subjectAreaKey;
      patch.schoolLevels = [...SCIENCE_TEXTBOOK_TAXONOMY.schoolLevels];
      patch.gradeLevels = [...SCIENCE_TEXTBOOK_TAXONOMY.gradeLevels];
      patch.subSubject = text(patchInput.category);
    }
    if (text(patchInput.publisher)) patch.publisher = text(patchInput.publisher);
    if (text(patchInput.price)) patch.price = text(patchInput.price);
    if (patchInput.status !== "keep") patch.status = patchInput.status;

    const nextSubSubject = text(patchInput.category) || getTextbookSubSubject(row);
    const taxonomyChanged =
      patchInput.schoolLevels !== null ||
      patchInput.gradeLevels !== null ||
      Boolean(text(patchInput.category));

    if (taxonomyChanged) {
      if (patchInput.schoolLevels !== null) patch.schoolLevels = patchInput.schoolLevels;
      if (patchInput.gradeLevels !== null) patch.gradeLevels = patchInput.gradeLevels;
      if (text(patchInput.category)) patch.subSubject = nextSubSubject;
    }

    return patch;
  }

  function createMasterBulkActionGuard() {
    const expectedIdentity = liveActionInputsRef.current.masterBulk;
    return () => liveActionInputsRef.current.masterBulk === expectedIdentity;
  }

  function applyBulkTextbookEdit() {
    if (!masterOptionsAccepted || selectedTextbookRows.length === 0 || !hasBulkTextbookPatchValues()) {
      return;
    }
    const selectedRows = [...selectedTextbookRows];
    const patchSnapshot = {
      ...bulkTextbookPatch,
      schoolLevels: bulkTextbookPatch.schoolLevels && [...bulkTextbookPatch.schoolLevels],
      gradeLevels: bulkTextbookPatch.gradeLevels && [...bulkTextbookPatch.gradeLevels],
    };
    const isCurrentMasterBulk = createMasterBulkActionGuard();
    const dialogRevision = masterBulkDialogRevisionRef.current;

    void runAction(
      "textbook-bulk-edit",
      async () => {
        await Promise.all(
          selectedRows.map((row) =>
            textbookService.upsertTextbookMaster({
              ...row,
              id: getRecordId(row),
              title: getTextbookTitle(row),
              price: text(row.sale_price || row.salePrice || row.price),
              status: normalizeStatusValue(row.status),
              ...getBulkTextbookPatchValues(row, patchSnapshot),
            }, { scienceSubjectAreas: acceptedMasterOptions?.scienceSubjectAreas || [] }),
          ),
        );
      },
      `${formatQuantity(selectedRows.length)}개 교재를 수정했습니다.`,
      invalidateMaster,
      () => masterBulkDialogRevisionRef.current === dialogRevision && isCurrentMasterBulk(),
    ).then((ok) => { if (ok) { dialogOpenerRef.current = masterSearchRef.current; setMasterBulkControlsOpen(false); setSelectedTextbookIds([]); setBulkTextbookPatch(emptyBulkTextbookPatch); } });
  }

  function applyBulkTextbookStatus(status: string) {
    if (selectedTextbookRows.length === 0) {
      return;
    }

    const selectedRows = [...selectedTextbookRows];
    const isCurrentMasterBulk = createMasterBulkActionGuard();
    const statusLabel = statusOptions.find((option) => option.value === status)?.label || status;
    void runAction(
      "textbook-bulk-status",
      async () => {
        await Promise.all(
          selectedRows.map((row) =>
            textbookService.upsertTextbookMaster({
              ...row,
              id: getRecordId(row),
              title: getTextbookTitle(row),
              price: text(row.sale_price || row.salePrice || row.price),
              status,
            }, { scienceSubjectAreas: acceptedMasterOptions?.scienceSubjectAreas || [] }),
          ),
        );
      },
      `${formatQuantity(selectedRows.length)}개 교재를 ${statusLabel}으로 변경했습니다.`,
      invalidateMaster,
      isCurrentMasterBulk,
    ).then((ok) => { if (ok) { setSelectedTextbookIds([]); setBulkTextbookPatch(emptyBulkTextbookPatch); } });
  }

  function deleteSelectedTextbooks() {
    if (selectedTextbookRows.length === 0) {
      return;
    }

    clearTransientTextbookFeedback();
    setConfirmationError("");
    textbookCleanupPreviewRef.current = selectedTextbookCleanupRows;
    setTextbookDeleteDialogOpen(true);
  }

  async function confirmDeleteSelectedTextbooks() {
    if (selectedTextbookRows.length === 0) {
      setTextbookDeleteDialogOpen(false);
      return false;
    }

    let deleteResult: Awaited<ReturnType<typeof textbookService.deleteTextbookMasters>> | undefined;
    const targetIds = [...selectedTextbookIds];
    const targetCount = selectedTextbookRows.length;
    const shouldClearSearchAfterDelete = Boolean(text(query)) &&
      filteredInventory.length > 0 &&
      filteredInventory.every((row) => targetIds.includes(getRecordId(row)));
    const isCurrentMasterBulk = createMasterBulkActionGuard();
    return runAction(
      "textbook-bulk-delete",
      async () => {
        deleteResult = await textbookService.deleteTextbookMasters(targetIds);
      },
      () => getTextbookDeleteResultMessage(deleteResult, targetCount),
      invalidateMaster,
      isCurrentMasterBulk,
    ).then((ok) => {
      if (!ok) return false;
      if (shouldClearSearchAfterDelete) updateMasterSearchQuery(""); else clearMasterSelection();
      return true;
    });
  }

  async function emptyInactiveTextbookTrash() {
    const expectedActorKey = actorKey;
    setSaving("textbook-trash-context");
    setActionErrorMessage("");
    try {
      const context = await getTextbookInactiveCleanupContext();
      assertLivePreparedSchemaReady();
      if (!isCurrentActionActor(expectedActorKey)) return;
      if (context.targetIds.length === 0) { setMessage("비울 미사용 교재가 없습니다."); return; }
      const targetIds = [...context.targetIds];
      let deleteResult: Awaited<ReturnType<typeof textbookService.purgeInactiveTextbooks>> | undefined;
      requestTextbookConfirmation({
        title: "미사용 보관함 비우기",
        description: `${formatQuantity(context.totalCount)}개 미사용 교재를 영구 삭제합니다. 이 작업은 되돌릴 수 없습니다.`,
        confirmLabel: "영구 삭제",
        items: context.previewRows.slice(0, 5),
        totalCount: context.totalCount,
        onConfirm: () => {
          return runAction(
            "textbook-trash-empty",
            async () => {
              const recheck = await getTextbookInactiveCleanupContext();
              assertLivePreparedSchemaReady();
              if (!isCurrentActionActor(expectedActorKey) || JSON.stringify(recheck.targetIds) !== JSON.stringify(targetIds)) throw new Error("정리 대상이 변경되었습니다. 다시 확인하세요.");
              deleteResult = await textbookService.purgeInactiveTextbooks(targetIds);
            },
            () => `${formatQuantity(deleteResult?.deletedIds.length || targetIds.length)}개 미사용 교재를 영구 삭제했습니다.`,
            invalidateMaster,
          ).then((ok) => { if (ok) { clearMasterSelection(); setBulkTextbookPatch(emptyBulkTextbookPatch); setTextbookQualityFilter("all"); } return ok; });
        },
      });
    } catch (contextError) {
      if (isCurrentActionActor(expectedActorKey)) setActionErrorMessage(getTextbookActionErrorMessage(contextError));
    } finally {
      if (isCurrentActionActor(expectedActorKey)) setSaving("");
    }
  }

  function selectPurchaseLine(line: Row, order: Row | undefined, stageOverride?: string, fromDirectDetail = false, directDetail?: TextbookPurchaseCaseRow) {
    clearTransientTextbookFeedback();
    const scopeLines = getPurchaseScopeLines(line);
    const primaryLine = scopeLines.find((scopeLine) => getRecordId(scopeLine) === getRecordId(line)) || scopeLines[0];
    if (!fromDirectDetail) {
      const anchorLineId = getRecordId(primaryLine);
      if (anchorLineId) navigateToTextbookDetail("purchase", anchorLineId);
      return;
    }
    if (purchaseDraftDirty && selectedPurchaseLineId === getRecordId(primaryLine)) return;
    const primaryOrder = order;
    const studentLine = scopeLines.find((scopeLine) => getTextbookCopyScope(scopeLine) === "student");
    const teacherLine = scopeLines.find((scopeLine) => getTextbookCopyScope(scopeLine) === "teacher");
    const status = text(primaryOrder?.status || primaryLine.status);
    const orderedQuantity = getRowFieldText(primaryLine, "ordered_quantity", "orderedQuantity");
    const requestedQuantity = getRowFieldText(primaryLine, "requested_quantity", "requestedQuantity");
    const primaryRequestedQuantity = requestedQuantity || orderedQuantity || "1";
    const nextStage = stageOverride || purchaseStageFromStatus(status);
    const nextOrderedQuantity = nextStage === "request" ? orderedQuantity : getPositivePurchaseQuantityText(orderedQuantity) || primaryRequestedQuantity;
    const requestedTitle = getRequestedTextbookTitle(primaryLine);
    const textbook = directDetail?.references.textbook || undefined;
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
    replacePurchaseForm({
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

  async function runAction(
    name: string,
    action: () => Promise<unknown>,
    success: string | (() => string),
    invalidate: () => Promise<void>,
    isCurrentInput: () => boolean = () => true,
  ) {
    if (schemaDisabledRef.current) return false;
    const actionKey = `${actorKey}:${name}`;
    if (pendingActionsRef.current.has(actionKey)) return false;
    pendingActionsRef.current.add(actionKey);
    const expectedActorKey = actorKey;
    const actionSequence = actionSequenceRef.current + 1;
    actionSequenceRef.current = actionSequence;
    const canPublish = () => isCurrentActionActor(expectedActorKey) && isCurrentInput() && !schemaDisabledRef.current;
    const clearOwnSaving = () => {
      pendingActionsRef.current.delete(actionKey);
      if (isCurrentActionActor(expectedActorKey) && actionSequenceRef.current === actionSequence) setSaving("");
    };
    setSaving(name);
    setActionErrorOwner(name);
    setMessage("");
    setActionErrorMessage("");
    let result: unknown;
    try {
      result = await action();
    } catch (actionError) {
      if (canPublish()) {
        setActionErrorMessage(getTextbookActionErrorMessage(actionError));
      }
      clearOwnSaving();
      return false;
    }
    if (!canPublish()) {
      clearOwnSaving();
      return false;
    }
    try {
      await invalidate();
    } catch (invalidationError) {
      if (canPublish()) setActionErrorMessage(`저장은 완료됐지만 화면을 갱신하지 못했습니다. ${getTextbookActionErrorMessage(invalidationError)}`);
      return canPublish();
    } finally {
      clearOwnSaving();
    }
    if (!canPublish()) return false;
    const publicClassesCacheRefresh = (result as { publicClassesCacheRefresh?: { status?: string } } | null)?.publicClassesCacheRefresh;
    const savedMessage = typeof success === "function" ? success() : success;
    setMessage(publicClassesCacheRefresh?.status === "pending"
      ? `${savedMessage} · 공개 수업 캐시 갱신 대기 중`
      : savedMessage);
    return true;
  }

  function assertLivePreparedSchemaReady() {
    if (!schemaDisabledRef.current) return;
    throw Object.assign(new Error("교재 읽기 API가 아직 적용되지 않았습니다."), { code: "textbook_read_rpc_unavailable" });
  }

  function submitMaster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionErrorOwner("master");
    if (!masterTaxonomyValidation.valid) {
      setActionErrorMessage(masterTaxonomyValidation.message);
      return;
    }
    if (isNewMasterDuplicate) {
      setActionErrorMessage("이미 등록된 교재입니다. 기존 교재를 열어 수정하세요.");
      return;
    }
    if (masterSubmitDisabled) return;
    const masterPayload = {
      ...masterForm,
      title: normalizeStoredTextInput(masterForm.title),
      publisher: normalizeStoredTextInput(masterForm.publisher),
      isbn13: normalizeBarcodeValue(masterForm.isbn13),
      barcode: normalizeBarcodeValue(masterForm.barcode || masterForm.isbn13),
      category: [
        getTextbookSchoolLevelSummary(masterForm),
        getTextbookGradeSummary(masterForm),
        masterForm.subSubject,
      ].filter(Boolean).join(" ") || masterForm.category,
    };
    const completedMasterTitle = getTextbookTitle(masterPayload);
    const expectedMasterForm = JSON.stringify(masterForm);
    void runAction(
      "master",
      () => textbookService.upsertTextbookMaster(
        masterPayload,
        { scienceSubjectAreas: acceptedMasterOptions?.scienceSubjectAreas || [] },
      ),
      "교재 마스터가 저장되었습니다.",
      invalidateMaster,
      () => liveActionInputsRef.current.master === expectedMasterForm,
    ).then((ok) => {
      if (ok) {
        if (completedMasterTitle) {
          showSavedMasterTextbook(completedMasterTitle);
        }
        setMasterDialogOpen(false);
        replaceMasterForm(emptyMasterForm);
      }
    });
  }

  function submitPurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (purchaseSubmitDisabled) return;
    setActionErrorOwner("purchase");
    const completedPurchaseStage = purchaseForm.requestStage;
    const completedPurchaseTitle = purchaseRequestTitle;
    const completedPurchaseHasCatalogTextbook = Boolean(selectedPurchaseTextbookId);
    const expectedPurchaseForm = JSON.stringify(purchaseForm);
    if (purchaseForm.requestStage === "request" && !selectedPurchaseLineId) {
      if (!canCreateTextbookRequest) {
        setActionErrorMessage("교재 요청을 등록할 권한이 없습니다.");
        return;
      }
      void runAction(
        "purchase",
        () => textbookService.createTextbookRequest({
          textbookId: selectedPurchaseTextbookId,
          requestedTextbookTitle: normalizeStoredTextInput(purchaseRequestTitle),
          classId: purchaseForm.classId,
          locationId: selectedLocationId,
          studentRequestedQuantity: getPurchaseScopeQuantity(purchaseForm, "student", "requested"),
          teacherRequestedQuantity: getPurchaseScopeQuantity(purchaseForm, "teacher", "requested"),
          memo: normalizeStoredTextInput(purchaseForm.memo),
        }),
        purchaseSuccessMessage(purchaseForm.requestStage, false),
        invalidatePurchase,
        () => liveActionInputsRef.current.purchase === expectedPurchaseForm,
      ).then((ok) => {
        if (ok) {
          showSavedPurchaseFlow(completedPurchaseStage, completedPurchaseTitle, completedPurchaseHasCatalogTextbook);
          setPurchaseDialogOpen(false);
          setSelectedPurchaseLineId("");
          setSelectedPurchaseScopeLineIds({ student: "", teacher: "" });
          replacePurchaseForm(emptyPurchaseForm);
        }
      });
      return;
    }
    if (!canManageTextbookOperations) {
      setActionErrorMessage("교재 요청을 관리할 권한이 없습니다.");
      return;
    }
    const directSnapshot = selectedPurchaseDetail && acceptedPurchaseDetail?.row ? {
      input: { ...selectedPurchaseDetail },
      memberLineIds: [...acceptedPurchaseDetail.row.memberLineIds],
      scopeLineIds: { ...selectedPurchaseScopeLineIds },
    } : null;
    const expectedPurchaseDirect = purchaseDirectIdentity;
    const isCurrentPurchaseAction = () => liveActionInputsRef.current.purchase === expectedPurchaseForm
      && liveActionInputsRef.current.purchaseDirect === expectedPurchaseDirect;
    void runAction(
      "purchase",
      async () => {
        if (!selectedPurchaseLineId) {
          const newPurchasePayloads = (["student", "teacher"] as TextbookCopyScope[]).flatMap((scope) => {
            const requestedQuantity = normalizePurchaseQuantityField(`${scope}RequestedQuantity`, getPurchaseScopeQuantity(purchaseForm, scope, "requested"));
            const orderedQuantity = normalizePurchaseQuantityField(`${scope}OrderedQuantity`, getPurchaseScopeQuantity(purchaseForm, scope, "ordered")) || requestedQuantity;
            const receivedQuantity = purchaseForm.requestStage === "receive"
              ? normalizePurchaseQuantityField(`${scope}ReceivedQuantity`, getPurchaseScopeQuantity(purchaseForm, scope, "received")) || orderedQuantity : "";
            const stageQuantity = purchaseForm.requestStage === "receive" ? numberValue(receivedQuantity) : numberValue(orderedQuantity);
            if (stageQuantity <= 0) return [];
            return [{
              ...purchaseForm,
              textbookId: selectedPurchaseTextbookId,
              requestedTextbookTitle: normalizeStoredTextInput(purchaseRequestTitle),
              requestedQuantity: requestedQuantity || orderedQuantity || receivedQuantity || "1",
              orderedQuantity,
              receivedQuantity,
              copyScope: scope,
              copy_scope: scope,
              supplierId: configuredPurchaseSupplierId,
              unitCost: String(getConfiguredTextbookPurchaseUnitCost(selectedPurchaseTextbook, configuredPurchaseSupplierId, selectedPurchaseSupplierRows, purchaseForm.unitCost, scope)),
              locationId: selectedLocationId,
              purchaseOrderId: "",
              purchaseOrderLineId: "",
              statementNumber: normalizeStoredTextInput(purchaseForm.statementNumber),
              createdBy: currentUserId,
            }];
          });
          for (const purchasePayload of newPurchasePayloads) await textbookService.createPurchaseReceipt(purchasePayload);
          return;
        }
        if (!directSnapshot) throw new Error("구매 작업 대상을 찾을 수 없습니다.");
        const fresh = await getTextbookPurchaseDetail(directSnapshot.input);
        assertLivePreparedSchemaReady();
        if (!isCurrentPurchaseAction()) throw new Error("구매 입력이 변경되었습니다. 다시 시도하세요.");
        const actualDetail = fresh.row;
        if (!actualDetail || JSON.stringify(actualDetail.memberLineIds) !== JSON.stringify(directSnapshot.memberLineIds)) {
          throw new Error("구매 작업 대상을 찾을 수 없습니다.");
        }
        const purchasePayloads = (["student", "teacher"] as TextbookCopyScope[]).flatMap((scope) => {
          const scopeLineId = directSnapshot.scopeLineIds[scope] || "";
          const actualLine = actualDetail.lines.find((line) => getTextbookCopyScope(line) === scope);
          if (!scopeLineId || !actualLine || getRecordId(actualLine) !== scopeLineId) return [];
          const requestedQuantity = normalizePurchaseQuantityField(`${scope}RequestedQuantity`, getPurchaseScopeQuantity(purchaseForm, scope, "requested"));
          const orderedQuantity = purchaseForm.requestStage === "request" ? ""
            : normalizePurchaseQuantityField(`${scope}OrderedQuantity`, getPurchaseScopeQuantity(purchaseForm, scope, "ordered")) || requestedQuantity;
          const receivedQuantity = purchaseForm.requestStage === "receive"
            ? normalizePurchaseQuantityField(`${scope}ReceivedQuantity`, getPurchaseScopeQuantity(purchaseForm, scope, "received")) || orderedQuantity : "";
          const stageQuantity = purchaseForm.requestStage === "receive" ? numberValue(receivedQuantity)
            : purchaseForm.requestStage === "order" ? numberValue(orderedQuantity) : numberValue(requestedQuantity);
          if (stageQuantity <= 0 && purchaseForm.requestStage !== "request") return [];
          return [{
            ...purchaseForm,
            textbookId: selectedPurchaseTextbookId,
            requestedTextbookTitle: normalizeStoredTextInput(purchaseRequestTitle),
            requestedQuantity: requestedQuantity || (purchaseForm.requestStage === "request" ? orderedQuantity || receivedQuantity || "1" : "0"),
            orderedQuantity,
            receivedQuantity,
            copyScope: scope,
            copy_scope: scope,
            supplierId: configuredPurchaseSupplierId,
            unitCost: String(getConfiguredTextbookPurchaseUnitCost(selectedPurchaseTextbook, configuredPurchaseSupplierId, selectedPurchaseSupplierRows, purchaseForm.unitCost, scope)),
            locationId: selectedLocationId,
            purchaseOrderId: getRecordId((actualLine.order as Row | null) || {}) || text(actualLine.purchase_order_id),
            purchaseOrderLineId: getRecordId(actualLine),
            statementNumber: normalizeStoredTextInput(purchaseForm.statementNumber),
            createdBy: currentUserId,
          }];
        });
        if (purchasePayloads.length === 0) throw new Error("구매 작업 대상을 찾을 수 없습니다.");
        if (!isCurrentPurchaseAction()) throw new Error("구매 입력이 변경되었습니다. 다시 시도하세요.");
        for (const purchasePayload of purchasePayloads) {
          await textbookService.updatePurchaseLifecycle(applyConfiguredPurchasePricingToPayload(purchasePayload, actualDetail.references));
        }
      },
      purchaseSuccessMessage(purchaseForm.requestStage, Boolean(selectedPurchaseLineId)),
      invalidatePurchase,
      isCurrentPurchaseAction,
    ).then((ok) => {
      if (ok) {
        showSavedPurchaseFlow(completedPurchaseStage, completedPurchaseTitle, completedPurchaseHasCatalogTextbook);
        setPurchaseDialogOpen(false);
        setSelectedPurchaseLineId("");
        setSelectedPurchaseScopeLineIds({ student: "", teacher: "" });
        replacePurchaseForm(emptyPurchaseForm);
      }
    });
  }

  function submitSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving === "sale" || saleSubmitDisabled) return;
    setActionErrorOwner("sale");
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
    const expectedSaleForm = JSON.stringify(saleForm);
    const expectedSaleRecipients = JSON.stringify(excludedStudentIds);
    const expectedActorKey = actorKey;
    const isCurrentSaleAction = () => liveActionInputsRef.current.sale === expectedSaleForm
      && liveActionInputsRef.current.saleRecipients === expectedSaleRecipients;
    void runAction(
      "sale",
      async () => {
        if (isTeacherSale) {
          const balance = await getTextbookInventoryBalance({ textbookIds: [saleForm.textbookId], locationId: saleLocationId });
          assertLivePreparedSchemaReady();
          if (!isCurrentActionActor(expectedActorKey) || !isCurrentSaleAction()) throw new Error("출고 입력이 변경되었습니다. 다시 시도하세요.");
          const balanceRow = balance.rows.find((row) => row.textbookId === saleForm.textbookId);
          if (!selectedSaleTextbook || acceptedSelectedLocation?.id !== saleLocationId || !balanceRow) throw new Error("출고 컨텍스트를 완성하지 못했습니다.");
          return textbookService.createTeacherTextbookIssue(
            {
              ...salePayload,
              copyScope: "teacher",
              copy_scope: "teacher",
              teacherName: saleTeacherName,
              quantity: saleTeacherQuantity,
            },
            { textbooks: [selectedSaleTextbook], inventory: [{ id: saleForm.textbookId, ...balanceRow }], teacherCatalogs: [], defaultLocationId: saleLocationId },
          );
        }
        const input = { classId: saleForm.classId, textbookId: saleForm.textbookId, locationId: saleLocationId, chargeMonth: normalizedSaleChargeMonth };
        const context = await getClassTextbookSaleContext(input);
        assertLivePreparedSchemaReady();
        if (!isCurrentActionActor(expectedActorKey) || !isCurrentSaleAction()) throw new Error("출고 입력이 변경되었습니다. 다시 시도하세요.");
        if (!context.complete) throw new Error("출고 컨텍스트를 완성하지 못했습니다.");
        if (context.duplicateCount > 0) throw new Error("이미 같은 월에 같은 수업·교재 출고가 있습니다.");
        return textbookService.createClassTextbookSale(
            {
              ...salePayload,
              copyScope: "student",
              copy_scope: "student",
            },
            { classes: [context.class], students: context.students, textbooks: [context.textbook], inventory: [{ id: input.textbookId, ...context.inventory }], defaultLocationId: input.locationId },
          );
      },
      isTeacherSale ? "교사용 출고 대기 목록에 추가했습니다." : "출고 대기 목록에 추가했습니다.",
      invalidateSales,
      isCurrentSaleAction,
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
    const textbook = numbered.sales.rows.find((row) => row.id === getRecordId(line))?.textbook;
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

  async function readFreshSaleActionContexts(lines: Row[], expectedSelection?: string) {
    const expectedActorKey = actorKey;
    const ids = [...new Set(lines.map(getRecordId).filter(Boolean))];
    const details = await Promise.all(ids.map((id) => getTextbookSaleDetail(id)));
    if (!isCurrentActionActor(expectedActorKey) || (expectedSelection !== undefined && liveActionInputsRef.current.saleSelection !== expectedSelection)) throw new Error("출고 작업 대상이 변경되었습니다.");
    const rows = details.map((detail) => detail.row).filter((row): row is NonNullable<typeof row> => Boolean(row));
    if (rows.length !== ids.length) throw new Error("출고 작업 대상을 찾을 수 없습니다.");
    const groups = new Map<string, string[]>();
    for (const row of rows) {
      const locationId = row.location?.id || text(row.line.location_id);
      const textbookId = getRecordId(row.textbook);
      if (!locationId || !textbookId) throw new Error("출고 위치와 교재를 확인할 수 없습니다.");
      groups.set(locationId, [...new Set([...(groups.get(locationId) || []), textbookId])]);
    }
    const balances = await Promise.all([...groups].map(([locationId, textbookIds]) => getTextbookInventoryBalance({ textbookIds, locationId })));
    assertLivePreparedSchemaReady();
    if (!isCurrentActionActor(expectedActorKey) || (expectedSelection !== undefined && liveActionInputsRef.current.saleSelection !== expectedSelection)) throw new Error("출고 작업 대상이 변경되었습니다.");
    return rows.map((row) => {
      const locationId = row.location?.id || text(row.line.location_id);
      const textbookId = getRecordId(row.textbook);
      const balance = balances.find((item) => item.locationId === locationId)?.rows.find((item) => item.textbookId === textbookId);
      if (!balance) throw new Error("출고 재고를 확인할 수 없습니다.");
      return { row, locationId, textbookId, balance };
    });
  }

  async function readFreshSaleDetails(lines: Row[], expectedSelection?: string) {
    const expectedActorKey = actorKey;
    const ids = [...new Set(lines.map(getRecordId).filter(Boolean))];
    const details = await Promise.all(ids.map((id) => getTextbookSaleDetail(id)));
    assertLivePreparedSchemaReady();
    if (!isCurrentActionActor(expectedActorKey) || (expectedSelection !== undefined && liveActionInputsRef.current.saleSelection !== expectedSelection)) throw new Error("출고 작업 대상이 변경되었습니다.");
    const rows = details.map((detail) => detail.row).filter((row): row is NonNullable<typeof row> => Boolean(row));
    if (rows.length !== ids.length) throw new Error("출고 작업 대상을 찾을 수 없습니다.");
    return rows;
  }

  function updateSaleLineStatus(line: Row, status: "issued" | "returned") {
    return runAction(
      `sale-line-${getRecordId(line)}`,
      async () => {
        const detail = await getTextbookSaleDetail(getRecordId(line));
        if (!detail.row || !isCurrentActionActor(actorKey)) throw new Error("출고 작업 대상을 찾을 수 없습니다.");
        const locationId = detail.row.location?.id || text(detail.row.line.location_id);
        const textbookId = getRecordId(detail.row.textbook);
        const balance = await getTextbookInventoryBalance({ textbookIds: [textbookId], locationId });
        assertLivePreparedSchemaReady();
        if (!isCurrentActionActor(actorKey)) throw new Error("출고 작업 대상이 변경되었습니다.");
        const balanceRow = balance.rows.find((row) => row.textbookId === textbookId);
        if (!balanceRow) throw new Error("출고 재고를 확인할 수 없습니다.");
        return textbookService.updateSaleLineStatus({ saleLineId: detail.row.id, status, createdBy: currentUserId }, {
          saleLines: [detail.row.line], inventory: [{ id: textbookId, ...balanceRow }], defaultLocationId: locationId,
        });
      },
      status === "returned" ? "고객 반품으로 처리했습니다." : "출고가 반영되었습니다.",
      invalidateSales,
    ).then((ok) => {
      if (ok) {
        showUpdatedSaleLine(line, status);
      }
      return ok;
    });
  }

  function getPurchaseConfirmationItems(line: Row, order: Row | undefined, references?: TextbookPurchaseCaseRow["references"]): TextbookConfirmationPreviewItem[] {
    const draft = buildPurchaseCardDraft(line, order);
    const prepared = preparedPurchaseRows.find((row) => row.memberLineIds.includes(getRecordId(line)));
    const textbook = references?.textbook || prepared?.references.textbook;
    const classRecord = references?.class || prepared?.references.class;
    const quantity = numberValue(draft.receivedQuantity || draft.orderedQuantity || draft.requestedQuantity) || 1;
    const locationLabel = getLocationName(locations, draft.locationId) || "위치 미지정";
    const classLabel = classRecord ? getClassName(classRecord) : "수업 미지정";
    const statusLabel = purchaseStatusLabel(line.status || order?.status, draft.orderedQuantity, draft.receivedQuantity);
    return [{
      id: getRecordId(line) || text(line.purchase_order_line_id || line.purchaseOrderLineId) || getPurchaseTextbookTitle(line, textbook || undefined),
      title: getPurchaseTextbookTitle(line, textbook || undefined),
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

  function getSaleDetailConfirmationItems(rows: SaleLineRow[]): TextbookConfirmationPreviewItem[] {
    return rows.map((row, index) => ({
      id: row.id || `${row.recipientName}-${index}`,
      title: getTextbookTitle(row.textbook),
      detail: [
        row.recipientName || "대상 미지정",
        getTextbookCopyScopeLabel(row.line.copy_scope),
        row.class ? getClassName(row.class) : "수업 미지정",
        row.location?.name || "위치 미지정",
        `${formatQuantity(row.quantity)}권`,
        saleStatusLabels[row.status] || row.status,
        row.sale?.charge_month || row.line.charge_month,
      ].filter(Boolean).join(" · "),
    }));
  }

  function deleteSaleLine(line: Row) {
    const rawStatus = text(line.status);
    const isHistory = rawStatus === "issued" || rawStatus === "returned" || rawStatus === "cancelled";
    if (isHistory && !canDeleteTextbookHistory) {
      return;
    }

    const expectedActorKey = actorKey;
    setSaving(`sale-context-${getRecordId(line)}`);
    void readFreshSaleDetails([line]).then(([detail]) => {
      if (!isCurrentActionActor(expectedActorKey)) return;
      requestTextbookConfirmation({
        title: isHistory ? "출고 이력 삭제" : "출고 대기 취소",
        description: isHistory ? "선택한 출고 이력과 연결된 재고 이동 기록을 삭제합니다." : "출고 대기 건을 취소하고 삭제합니다.",
        confirmLabel: isHistory ? "이력 삭제" : "취소 삭제",
        items: getSaleDetailConfirmationItems([detail]),
        onConfirm: () => {
          return runAction(
            `sale-delete-${detail.id}`,
            async () => {
              const [rechecked] = await readFreshSaleDetails([detail.line]);
              return textbookService.deleteSaleLineLifecycle({ saleLineId: rechecked.id, saleId: text(rechecked.line.sale_id) });
            },
            isHistory ? "출고 이력을 삭제했습니다." : "출고 대기 건을 삭제했습니다.",
            invalidateSales,
          );
        },
      });
    }, (contextError) => { if (isCurrentActionActor(expectedActorKey)) setActionErrorMessage(getTextbookActionErrorMessage(contextError)); })
      .finally(() => { if (isCurrentActionActor(expectedActorKey)) setSaving(""); });
  }

  function returnSaleLine(line: Row) {
    const expectedActorKey = actorKey;
    setSaving(`sale-context-${getRecordId(line)}`);
    void readFreshSaleActionContexts([line]).then(([context]) => {
      if (!isCurrentActionActor(expectedActorKey)) return;
      requestTextbookConfirmation({
        title: "고객 반품 처리",
        description: "출고 완료 건을 고객 반품으로 처리합니다.",
        confirmLabel: "반품 처리",
        items: getSaleDetailConfirmationItems([context.row]),
        onConfirm: () => updateSaleLineStatus(context.row.line, "returned"),
      });
    }, (contextError) => { if (isCurrentActionActor(expectedActorKey)) setActionErrorMessage(getTextbookActionErrorMessage(contextError)); })
      .finally(() => { if (isCurrentActionActor(expectedActorKey)) setSaving(""); });
  }

  function issueSelectedSaleLines() {
    if (selectedIssuableSaleLines.length === 0) {
      return;
    }
    const issuedTextbookTitles = [...new Set(selectedIssuableSaleLines
      .map((line) => {
        const textbook = numbered.sales.rows.find((row) => row.id === getRecordId(line))?.textbook;
        return getTextbookTitle(textbook || {});
      })
      .filter(Boolean))];

    const expectedSelection = JSON.stringify(selectedSaleLineIds);
    const isCurrentSelection = () => liveActionInputsRef.current.saleSelection === expectedSelection;
    void runAction(
      "sale-bulk-issue",
      async () => {
        const contexts = await readFreshSaleActionContexts(selectedIssuableSaleLines, expectedSelection);
        for (const context of contexts) await textbookService.updateSaleLineStatus({ saleLineId: context.row.id, status: "issued", createdBy: currentUserId }, {
          saleLines: [context.row.line], inventory: [{ id: context.textbookId, ...context.balance }], defaultLocationId: context.locationId,
        });
      },
      `${formatQuantity(selectedIssuableSaleLines.length)}건을 출고 완료했습니다.`,
      invalidateSales,
      isCurrentSelection,
    ).then((ok) => {
      if (!ok) return;
      setSelectedSaleLineIds([]);
      setSalesProcessFilter("issued");
      if (issuedTextbookTitles.length === 1) updateOperationSearchQuery(issuedTextbookTitles[0]);
    });
  }

  function cancelSelectedSaleLines() {
    if (selectedCancelableSaleLines.length === 0) {
      return;
    }
    const expectedSelection = JSON.stringify(selectedSaleLineIds);
    const expectedActorKey = actorKey;
    setSaving("sale-bulk-context");
    void readFreshSaleDetails(selectedCancelableSaleLines, expectedSelection).then((details) => {
      if (!isCurrentActionActor(expectedActorKey)) return;
      requestTextbookConfirmation({
        title: "출고 전 취소",
        description: `${formatQuantity(details.length)}건을 출고 전 취소로 삭제합니다.`,
        confirmLabel: "취소 삭제",
        items: getSaleDetailConfirmationItems(details),
        onConfirm: () => {
        return runAction(
          "sale-bulk-cancel",
          async () => {
            const rechecked = await readFreshSaleDetails(details.map((detail) => detail.line), expectedSelection);
            for (const detail of rechecked) {
              await textbookService.deleteSaleLineLifecycle({
                saleLineId: detail.id,
                saleId: detail.line.sale_id,
              });
            }
          },
          `${formatQuantity(details.length)}건을 출고 전 취소했습니다.`,
          invalidateSales,
          () => liveActionInputsRef.current.saleSelection === expectedSelection,
        ).then((ok) => { if (ok) setSelectedSaleLineIds([]); return ok; });
        },
      });
    }, (contextError) => { if (isCurrentActionActor(expectedActorKey)) setActionErrorMessage(getTextbookActionErrorMessage(contextError)); })
      .finally(() => { if (isCurrentActionActor(expectedActorKey)) setSaving(""); });
  }

  function returnSelectedSaleLines() {
    if (selectedReturnableSaleLines.length === 0) {
      return;
    }
    const returnedTextbookTitles = [...new Set(selectedReturnableSaleLines
      .map((line) => getSaleLineTextbookTitle(line))
      .filter(Boolean))];
    const expectedSelection = JSON.stringify(selectedSaleLineIds);
    const expectedActorKey = actorKey;
    setSaving("sale-bulk-context");
    void readFreshSaleActionContexts(selectedReturnableSaleLines, expectedSelection).then((initialContexts) => {
      if (!isCurrentActionActor(expectedActorKey)) return;
      requestTextbookConfirmation({
        title: "고객 반품 처리",
        description: `${formatQuantity(initialContexts.length)}건을 고객 반품으로 처리합니다.`,
        confirmLabel: "반품 처리",
        items: getSaleDetailConfirmationItems(initialContexts.map((context) => context.row)),
        onConfirm: () => {
        return runAction(
          "sale-bulk-return",
          async () => {
            const contexts = await readFreshSaleActionContexts(initialContexts.map((context) => context.row.line), expectedSelection);
            for (const context of contexts) await textbookService.updateSaleLineStatus({ saleLineId: context.row.id, status: "returned", createdBy: currentUserId }, {
              saleLines: [context.row.line], inventory: [{ id: context.textbookId, ...context.balance }], defaultLocationId: context.locationId,
            });
          },
          `${formatQuantity(initialContexts.length)}건을 고객 반품으로 처리했습니다.`,
          invalidateSales,
          () => liveActionInputsRef.current.saleSelection === expectedSelection,
        ).then((ok) => {
          if (!ok) return false;
          setSelectedSaleLineIds([]);
          setSalesProcessFilter("returned");
          if (returnedTextbookTitles.length === 1) updateOperationSearchQuery(returnedTextbookTitles[0]);
          return true;
        });
        },
      });
    }, (contextError) => { if (isCurrentActionActor(expectedActorKey)) setActionErrorMessage(getTextbookActionErrorMessage(contextError)); })
      .finally(() => { if (isCurrentActionActor(expectedActorKey)) setSaving(""); });
  }

  function deleteSelectedSaleHistoryLines() {
    if (!canDeleteTextbookHistory || selectedDeletableSaleLines.length === 0) {
      return;
    }
    const expectedSelection = JSON.stringify(selectedSaleLineIds);
    const expectedActorKey = actorKey;
    setSaving("sale-bulk-context");
    void readFreshSaleDetails(selectedDeletableSaleLines, expectedSelection).then((details) => {
      if (!isCurrentActionActor(expectedActorKey)) return;
      requestTextbookConfirmation({
        title: "출고 이력 삭제",
        description: `${formatQuantity(details.length)}건의 출고/반품 이력과 연결된 재고 이동 기록을 삭제합니다.`,
        confirmLabel: "이력 삭제",
        items: getSaleDetailConfirmationItems(details),
        onConfirm: () => {
        return runAction(
          "sale-bulk-delete-history",
          async () => {
            const rechecked = await readFreshSaleDetails(details.map((detail) => detail.line), expectedSelection);
            for (const detail of rechecked) await textbookService.deleteSaleLineLifecycle({ saleLineId: detail.id, saleId: detail.line.sale_id });
          },
          `${formatQuantity(details.length)}건의 출고/반품 이력을 삭제했습니다.`,
          invalidateSales,
          () => liveActionInputsRef.current.saleSelection === expectedSelection,
        ).then((ok) => { if (ok) setSelectedSaleLineIds([]); return ok; });
        },
      });
    }, (contextError) => { if (isCurrentActionActor(expectedActorKey)) setActionErrorMessage(getTextbookActionErrorMessage(contextError)); })
      .finally(() => { if (isCurrentActionActor(expectedActorKey)) setSaving(""); });
  }

  function movePurchaseLine(line: Row, order: Row | undefined, status: PurchaseKanbanStatus, draft?: PurchaseKanbanDraft) {
    if (text(line.status) === status || text(order?.status) === status) {
      return;
    }

    void runAction(
      `purchase-move-${getRecordId(line)}`,
      async () => {
        const [detail] = await readFreshPurchaseMembers([line], status === "ordered" ? "request" : "order");
        const scopeLines = detail.lines;
        for (const scopeLine of scopeLines) {
          const scopeOrder = (scopeLine.order as Row | null) || order;
          const movePayload = draft && scopeLines.length === 1
            ? buildPurchasePayloadFromDraft(scopeLine, scopeOrder, draft, status)
            : buildPurchaseStatusPayload(scopeLine, scopeOrder, status);
          await textbookService.updatePurchaseLifecycle(
            applyConfiguredPurchasePricingToPayload(
              {
                ...movePayload,
                textbookId: getPurchaseLineTextbookId(scopeLine, detail.references) || text(movePayload.textbookId),
                requestedTextbookTitle: normalizeStoredTextInput(text(movePayload.requestedTextbookTitle || getRequestedTextbookTitle(scopeLine))),
              },
              detail.references,
            ),
          );
        }
      },
      "상태가 변경되었습니다.",
      invalidatePurchase,
    );
  }

  function deletePurchaseLine(line: Row, order: Row | undefined) {
    const expectedActorKey = actorKey;
    const mode = text(line.status || order?.status) === "requested" ? "request" as const : "order" as const;
    setSaving(`purchase-context-${getRecordId(line)}`);
    void readFreshPurchaseMembers([line], mode).then(([detail]) => {
      if (!isCurrentActionActor(expectedActorKey)) return;
      const scopeLines = detail.lines;
      requestTextbookConfirmation({
        title: scopeLines.length > 1 ? "요청 묶음 삭제" : "요청 삭제",
        description: scopeLines.length > 1 ? "학생용과 교사용 요청을 함께 삭제합니다." : "이 요청 건을 삭제합니다.",
        confirmLabel: "삭제",
        items: scopeLines.flatMap((scopeLine) => getPurchaseConfirmationItems(scopeLine, (scopeLine.order as Row | null) || order, detail.references)),
        onConfirm: () => {
          return runAction(
            `purchase-delete-${getRecordId(line)}`,
            async () => {
              const [rechecked] = await readFreshPurchaseMembers([line], mode);
              for (const scopeLine of rechecked.lines) {
                const scopeOrder = scopeLine.order || order;
                await textbookService.deletePurchaseLifecycle({
                  purchaseOrderId: getRecordId(scopeOrder || {}) || text(scopeLine.purchase_order_id || scopeLine.purchaseOrderId),
                  purchaseOrderLineId: getRecordId(scopeLine),
                });
              }
            },
            scopeLines.length > 1 ? "요청 묶음을 삭제했습니다." : "요청 건을 삭제했습니다.",
            invalidatePurchase,
          );
        },
      });
    }, (contextError) => {
      if (isCurrentActionActor(expectedActorKey)) setActionErrorMessage(getTextbookActionErrorMessage(contextError));
    }).finally(() => { if (isCurrentActionActor(expectedActorKey)) setSaving(""); });
  }

  function returnPurchaseLine(line: Row, order: Row | undefined) {
    const expectedActorKey = actorKey;
    setSaving(`purchase-context-${getRecordId(line)}`);
    void readFreshPurchaseMembers([line], "order").then(([detail]) => {
      if (!isCurrentActionActor(expectedActorKey)) return;
      requestTextbookConfirmation({
        title: "공급처 반품",
        description: "입고 완료 건을 공급처 반품으로 처리합니다.",
        confirmLabel: "반품 처리",
        items: detail.lines.flatMap((member) => getPurchaseConfirmationItems(member, (member.order as Row | null) || order, detail.references)),
        onConfirm: () => {
        return runAction(
          `purchase-return-${getRecordId(line)}`,
          async () => {
            const [rechecked] = await readFreshPurchaseMembers([detail.line], "order");
            for (const member of rechecked.lines) await textbookService.returnPurchaseLifecycle({
              purchaseOrderId: getRecordId(member.order || {}) || member.purchase_order_id,
              purchaseOrderLineId: member.id,
              createdBy: currentUserId,
              memo: "공급처 반품",
            });
          },
          "공급처 반품으로 처리했습니다.",
          invalidatePurchase,
        );
        },
      });
    }, (contextError) => { if (isCurrentActionActor(expectedActorKey)) setActionErrorMessage(getTextbookActionErrorMessage(contextError)); })
      .finally(() => { if (isCurrentActionActor(expectedActorKey)) setSaving(""); });
  }

  function returnSelectedPurchaseLines() {
    if (selectedReturnablePurchaseLines.length === 0) {
      return;
    }
    const expectedSelection = JSON.stringify(selectedPurchaseLineIds);
    const expectedActorKey = actorKey;
    setSaving("purchase-bulk-context");
    void readFreshPurchaseMembers(selectedReturnablePurchaseLines, "order", expectedSelection).then((details) => {
      if (!isCurrentActionActor(expectedActorKey)) return;
      requestTextbookConfirmation({
        title: "공급처 반품",
        description: `${formatQuantity(details.length)}건을 공급처 반품으로 처리합니다.`,
        confirmLabel: "반품 처리",
        items: details.flatMap((detail) => detail.lines.flatMap((member) => getPurchaseConfirmationItems(member, (member.order as Row | null) || undefined, detail.references))),
        onConfirm: () => {
        return runAction(
          "purchase-bulk-return",
          async () => {
            const rechecked = await readFreshPurchaseMembers(details.map((detail) => detail.line), "order", expectedSelection);
            for (const detail of rechecked) for (const member of detail.lines) await textbookService.returnPurchaseLifecycle({
              purchaseOrderId: getRecordId(member.order || {}) || member.purchase_order_id,
              purchaseOrderLineId: member.id,
              createdBy: currentUserId,
              memo: "공급처 반품",
            });
          },
          `${formatQuantity(details.length)}건을 공급처 반품으로 처리했습니다.`,
          invalidatePurchase,
          () => liveActionInputsRef.current.purchaseSelection === expectedSelection,
        ).then((ok) => { if (ok) setSelectedPurchaseLineIds([]); return ok; });
        },
      });
    }, (contextError) => { if (isCurrentActionActor(expectedActorKey)) setActionErrorMessage(getTextbookActionErrorMessage(contextError)); })
      .finally(() => { if (isCurrentActionActor(expectedActorKey)) setSaving(""); });
  }

  function setInventoryCountDraft(row: InventoryCountRow, value: string) {
    const draftKey = getInventoryCountDraftKey(row.id, row.locationId);
    inventoryCountDraftRevisionsRef.current[draftKey] = (inventoryCountDraftRevisionsRef.current[draftKey] || 0) + 1;
    setInventoryCountDrafts((current) => ({
      ...current,
      [draftKey]: normalizeQuantityInput(value, { allowZero: true }),
    }));
  }

  function setInventoryCountMemoDraft(row: InventoryCountRow, value: string) {
    const draftKey = getInventoryCountDraftKey(row.id, row.locationId);
    inventoryCountDraftRevisionsRef.current[draftKey] = (inventoryCountDraftRevisionsRef.current[draftKey] || 0) + 1;
    setInventoryCountMemoDrafts((current) => ({
      ...current,
      [draftKey]: normalizeInlineTextInput(value),
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
    delete inventoryCountDraftRevisionsRef.current[draftKey];
    delete inventoryCountRequestsRef.current[draftKey];
  }

  function isCurrentInventoryAction(
    snapshots: Array<{ key: string; textbookId: string; quantity: string; memo: string; revision: number; selectionRevision: number }>,
    expectedSelection?: string,
  ) {
    const current = JSON.parse(liveActionInputsRef.current.inventory) as {
      selection: string[];
      drafts: Record<string, string>;
      memos: Record<string, string>;
      revisions: Record<string, number>;
      selectionRevisions: Record<string, number>;
    };
    if (expectedSelection !== undefined && JSON.stringify(current.selection) !== expectedSelection) return false;
    return snapshots.every((snapshot) => current.drafts[snapshot.key] === snapshot.quantity
      && normalizeStoredTextInput(current.memos[snapshot.key]) === snapshot.memo
      && (current.revisions[snapshot.key] || 0) === snapshot.revision
      && (current.selectionRevisions[snapshot.textbookId] || 0) === snapshot.selectionRevision);
  }

  function getInventoryCountRequest(key: string, quantity: string, memo: string, revision: number) {
    const fingerprint = JSON.stringify([actorKey, quantity, memo, revision]);
    const previous = inventoryCountRequestsRef.current[key];
    if (previous?.fingerprint === fingerprint) return previous;
    const request = { fingerprint, requestId: crypto.randomUUID(), countedAt: new Date().toISOString().slice(0, 10) };
    inventoryCountRequestsRef.current[key] = request;
    return request;
  }

  function submitInlineStockCount(row: InventoryCountRow, countedQuantity: string, memo = "") {
    const normalizedQuantity = normalizeQuantityInput(countedQuantity, { allowZero: true });
    const normalizedMemo = normalizeStoredTextInput(memo);
    if (!normalizedQuantity) {
      setMessage("실사 수량을 입력하세요.");
      return;
    }

    const draftKey = getInventoryCountDraftKey(row.id, row.locationId);
    const expectedActorKey = actorKey;
    const submittedRevision = inventoryCountDraftRevisionsRef.current[draftKey] || 0;
    const snapshot = { key: draftKey, textbookId: row.id, quantity: normalizedQuantity, memo: normalizedMemo, revision: submittedRevision,
      selectionRevision: textbookSelectionRevisionsRef.current[row.id] || 0 };
    const isCurrentCountAction = () => isCurrentInventoryAction([snapshot]);
    void runAction(
      `count-inline-${draftKey}`,
      async () => {
        const balance = await getTextbookInventoryBalance({ textbookIds: [row.id], locationId: row.locationId });
        assertLivePreparedSchemaReady();
        if (!isCurrentActionActor(expectedActorKey) || !isCurrentCountAction()) throw new Error("재고 작업 대상이 변경되었습니다.");
        const authoritative = balance.rows.find((item) => item.textbookId === row.id);
        if (!authoritative) throw new Error("재고 수량을 확인할 수 없습니다.");
        return textbookService.createStockCountAdjustment({
          ...getInventoryCountRequest(draftKey, normalizedQuantity, normalizedMemo, submittedRevision),
          textbookId: row.id, locationId: row.locationId, countedQuantity: normalizedQuantity,
          expectedQuantity: authoritative.currentQuantity, sale_price: getTextbookSalePrice(row.source), memo: normalizedMemo, createdBy: currentUserId,
        });
      },
      "실사 수량이 반영되었습니다.",
      invalidateInventory,
      isCurrentCountAction,
    ).then((ok) => {
      if (ok) {
        updateMasterSearchQuery(row.title);
        if ((inventoryCountDraftRevisionsRef.current[draftKey] || 0) !== submittedRevision) return;
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
        delete inventoryCountDraftRevisionsRef.current[draftKey];
        delete inventoryCountRequestsRef.current[draftKey];
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

    const expectedActorKey = actorKey;
    const expectedSelection = JSON.stringify(selectedTextbookIds);
    const snapshots = readyRows.map((row) => {
      const key = getInventoryCountDraftKey(row.id, row.locationId);
      return { row, key, textbookId: row.id, quantity: normalizeQuantityInput(inventoryCountDrafts[key], { allowZero: true }), memo: normalizeStoredTextInput(inventoryCountMemoDrafts[key]), revision: inventoryCountDraftRevisionsRef.current[key] || 0,
        selectionRevision: textbookSelectionRevisionsRef.current[row.id] || 0 };
    });
    const completedSnapshots: typeof snapshots = [];
    const isCurrentBulkCountAction = () => isCurrentInventoryAction(snapshots, expectedSelection);
    void runAction(
      "count-inline-bulk",
      async () => {
        const groups = new Map<string, string[]>();
        for (const snapshot of snapshots) groups.set(snapshot.row.locationId, [...new Set([...(groups.get(snapshot.row.locationId) || []), snapshot.row.id])]);
        const balances = await Promise.all([...groups].map(([locationId, textbookIds]) => getTextbookInventoryBalance({ textbookIds, locationId })));
        assertLivePreparedSchemaReady();
        if (!isCurrentActionActor(expectedActorKey) || !isCurrentBulkCountAction()) throw new Error("재고 작업 대상이 변경되었습니다.");
        for (const snapshot of snapshots) {
          const authoritative = balances.find((balance) => balance.locationId === snapshot.row.locationId)?.rows.find((item) => item.textbookId === snapshot.row.id);
          if (!authoritative) throw new Error("선택한 모든 재고 수량을 확인할 수 없습니다.");
        }
        if (!isCurrentBulkCountAction()) throw new Error("재고 작업 대상이 변경되었습니다.");
        for (const snapshot of snapshots) {
          if (!isCurrentActionActor(expectedActorKey)) throw new Error("재고 작업 계정이 변경되었습니다.");
          const authoritative = balances.find((balance) => balance.locationId === snapshot.row.locationId)!.rows.find((item) => item.textbookId === snapshot.row.id)!;
          await textbookService.createStockCountAdjustment({ ...getInventoryCountRequest(snapshot.key, snapshot.quantity, snapshot.memo, snapshot.revision), textbookId: snapshot.row.id, locationId: snapshot.row.locationId, countedQuantity: snapshot.quantity,
            expectedQuantity: authoritative.currentQuantity, sale_price: getTextbookSalePrice(snapshot.row.source), memo: snapshot.memo, createdBy: currentUserId });
          completedSnapshots.push(snapshot);
        }
      },
      `${formatQuantity(readyRows.length)}건의 실사 수량을 반영했습니다.`,
      invalidateInventory,
      isCurrentBulkCountAction,
    ).then((ok) => {
      const acknowledged = completedSnapshots.filter((snapshot) => isCurrentActionActor(expectedActorKey) && (inventoryCountDraftRevisionsRef.current[snapshot.key] || 0) === snapshot.revision
        && (textbookSelectionRevisionsRef.current[snapshot.textbookId] || 0) === snapshot.selectionRevision);
      setInventoryCountDrafts((current) => {
        const next = { ...current };
        acknowledged.forEach((snapshot) => { delete next[snapshot.key]; });
        return next;
      });
      setInventoryCountMemoDrafts((current) => {
        const next = { ...current };
        acknowledged.forEach((snapshot) => { delete next[snapshot.key]; delete inventoryCountDraftRevisionsRef.current[snapshot.key]; delete inventoryCountRequestsRef.current[snapshot.key]; });
        return next;
      });
      const acknowledgedRowIds = new Set(acknowledged.map((snapshot) => snapshot.row.id));
      setSelectedTextbookIds((current) => current.filter((id) => !acknowledgedRowIds.has(id)));
      if (!ok) return;
      if (readyRows.length === 1) updateMasterSearchQuery(readyRows[0].title);
    });
  }

  function deleteInventoryHistory(row: InventoryHistoryRow) {
    if (!canDeleteTextbookHistory) {
      return;
    }

    requestTextbookConfirmation({
      title: "재고 이력 삭제",
      description: "선택한 재고 이력을 삭제합니다. 재고 수량도 즉시 다시 계산됩니다.",
      confirmLabel: "이력 삭제",
      items: [{ id: row.id, title: row.textbookTitle, detail: [row.locationName, row.action, row.change, row.at].filter(Boolean).join(" · ") }],
      onConfirm: () => {
        return runAction(
          `inventory-history-delete-${row.id}`,
          () => textbookService.deleteInventoryHistory({
            kind: row.kind,
            id: row.sourceId,
            linkedMoveId: row.linkedMoveId,
          }),
          "재고 이력을 삭제했습니다.",
          invalidateInventory,
        );
      },
    });
  }

  function rememberTextbookDialogOpener(event: React.SyntheticEvent) {
    if (masterDialogOpen || masterBulkControlsOpen || purchaseDialogOpen || bulkOrderDialogOpen || saleDialogOpen || textbookDeleteDialogOpen || confirmationRequest) return;
    if (!(event.target instanceof Element) || event.target.closest('[role="dialog"], [role="alertdialog"]')) return;
    const button = event.target.closest<HTMLButtonElement>("button");
    if (button) dialogOpenerRef.current = button;
  }

  const listReadIssue = preparedSchemaOwner ? {
    label: "운영 정보 확인 필요", message: getTextbookActionErrorMessage(preparedSchemaOwner.error),
    retryLabel: "교재 운영 API 다시 시도", onRetry: preparedSchemaOwner.retry,
  } : activeTab === "inventory" && inventoryLocationReference.error ? {
    label: "위치 조회 실패", message: inventoryLocationReference.error,
    retryLabel: "재고 위치 다시 시도", onRetry: referenceData.locationOptions.retry,
  } : activePrimaryState.error ? {
    label: "목록 조회 실패", message: getTextbookActionErrorMessage(activePrimaryState.error),
    retryLabel: "교재 목록 다시 시도", onRetry: activePrimaryState.retry,
  } : activeSummaryResource?.error ? {
    label: "집계 조회 실패", message: getTextbookActionErrorMessage(activeSummaryResource.error),
    retryLabel: "교재 집계 다시 시도", onRetry: activeSummaryResource.retry,
  } : !masterDialogOpen && !masterBulkControlsOpen && masterOptionsInput && referenceData.masterOptions.error ? {
    label: "분류 조회 실패", message: getTextbookActionErrorMessage(referenceData.masterOptions.error),
    retryLabel: "교재 분류 다시 시도", onRetry: referenceData.masterOptions.retry,
  } : null;
  const listReadFeedback = listReadIssue ? <DataTableReadFeedback {...listReadIssue} returnFocusRef={activeTab === "master" || activeTab === "inventory" ? masterSearchRef : operationSearchRef} /> : null;

  return (
    <div data-slot="textbook-workspace" onClickCapture={rememberTextbookDialogOpener} onFocusCapture={rememberTextbookDialogOpener} className="flex min-h-[calc(100dvh-5rem)] min-w-0 flex-col gap-3 px-4 md:min-h-[calc(100dvh-7.25rem)] lg:px-6">
      {draftNavigationConfirmation}
      {(actionErrorMessage || message) && !(
        (masterDialogOpen && actionErrorOwner === "master")
        || (purchaseDialogOpen && actionErrorOwner === "purchase")
        || (saleDialogOpen && actionErrorOwner === "sale")
        || (bulkOrderDialogOpen && actionErrorOwner === "purchase-bulk-order")
        || (masterBulkControlsOpen && actionErrorOwner === "textbook-bulk-edit")
        || textbookDeleteDialogOpen || Boolean(confirmationRequest)
      ) ? (
        <ActionFeedback
          message={actionErrorMessage || message}
          error={Boolean(actionErrorMessage)}
          onDismiss={clearTransientTextbookFeedback}
          returnFocusRef={activeTab === "master" || activeTab === "inventory" ? masterSearchRef : operationSearchRef}
        />
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

      {textbookDeleteDialogOpen ? <Dialog open={textbookDeleteDialogOpen} onOpenChange={(open) => { if (!open) closeTextbookConfirmation(); }}>
        <ConfirmationDialogContent
          title="선택 교재 정리"
          description={`${formatQuantity(textbookCleanupPreviewRef.current.length)}개 교재를 삭제하거나 미사용으로 전환합니다. 재고·주문·출고 이력이 있으면 기록 보존을 위해 미사용으로 전환됩니다.`}
          items={textbookCleanupPreviewRef.current}
          itemsLabel="정리 대상 교재"
          confirmLabel="정리 실행"
          onConfirm={() => { void executeTextbookConfirmation(confirmDeleteSelectedTextbooks, () => setTextbookDeleteDialogOpen(false)); }}
          onCancel={closeTextbookConfirmation}
          busy={confirmationBusy}
          error={actionErrorMessage || confirmationError}
          returnFocusRef={dialogOpenerRef}
        />
      </Dialog> : null}

      {confirmationRequest ? <Dialog open={Boolean(confirmationRequest)} onOpenChange={(open) => { if (!open) closeTextbookConfirmation(); }}>
        <ConfirmationDialogContent
          title={confirmationRequest.title}
          description={confirmationRequest.description}
          items={confirmationRequest.items}
          totalCount={confirmationRequest.totalCount}
          confirmLabel={confirmationRequest.confirmLabel}
          onConfirm={confirmTextbookAction}
          onCancel={closeTextbookConfirmation}
          busy={confirmationBusy}
          error={actionErrorMessage || confirmationError}
          returnFocusRef={dialogOpenerRef}
        />
      </Dialog> : null}

      {masterDialogOpen ? (
      <Dialog open={masterDialogOpen} onOpenChange={(open) => (open ? setMasterDialogOpen(true) : closeMasterDialog())}>
        <FormDialogContent
          returnFocusRef={dialogOpenerRef}
          title={masterForm.id ? "교재 수정" : "교재 신규 등록"}
          description="교재명, 학년, 세부과목, 출판사, 판매가, ISBN, 바코드를 등록하거나 수정합니다."
          onSubmit={submitMaster}
          onCancel={closeMasterDialog}
          cancelLabel="교재 등록 취소"
          submitLabel={masterForm.id ? "변경 저장" : "교재 등록"}
          submitAriaLabel="교재 저장"
          submitDisabled={masterSubmitDisabled}
          busy={saving === "master"}
          error={actionErrorOwner === "master" ? actionErrorMessage : ""}
          hint={masterSubmitHint}
        >
            {referenceData.masterOptions.error ? (
              <Alert role="alert"><AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{getTextbookActionErrorMessage(referenceData.masterOptions.error)}</span>
                <Button type="button" variant="outline" size="sm" aria-label="교재 분류 설정 다시 시도" onClick={() => { void referenceData.masterOptions.retry(); }}>다시 시도</Button>
              </AlertDescription></Alert>
            ) : null}
            {referenceData.masterDuplicate.error ? (
              <Alert role="alert">
                <AlertDescription className="flex items-center justify-between gap-3">
                  <span>{getTextbookActionErrorMessage(referenceData.masterDuplicate.error)}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => { void referenceData.masterDuplicate.retry(); }}>다시 시도</Button>
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><Field label="교재명" required>
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
              </Field></div>
              <Field label="과목" required>
                <Select
                  value={masterForm.subject}
                  onValueChange={(value) =>
                    setMasterForm((current) => {
                      if (value === "science") {
                        return {
                          ...current,
                          subject: value,
                          subjectAreaKey: "",
                          schoolLevels: [...SCIENCE_TEXTBOOK_TAXONOMY.schoolLevels],
                          gradeLevels: [...SCIENCE_TEXTBOOK_TAXONOMY.gradeLevels],
                          subSubject: "",
                        };
                      }
                      return {
                        ...current,
                        subject: value,
                        subjectAreaKey: "",
                        subSubject: getSubSubjectOptionsForSubject(textbookSubSubjectSettings, value).includes(current.subSubject)
                          ? current.subSubject
                          : "",
                      };
                    })
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
              <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-sm" role="alert">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="font-medium">이미 등록된 교재 {formatQuantity(masterDuplicateTotalCount)}건</span>
                  {isNewMasterDuplicate ? <Badge variant="outline" className="shrink-0 rounded-md">저장 잠김</Badge> : null}
                </div>
                <div className="grid gap-1">
                  {masterDuplicatePreviewRows.map((row) => {
                    const rowId = getRecordId(row);
                    const duplicateLabel = [getPublisherLabel(row), getCategoryLabel(row)].filter(Boolean).join(" · ");
                    return (
                      <Button
                        variant="outline"
                        key={rowId}
                        type="button"
                        className="h-auto min-w-0 flex-col items-start whitespace-normal py-2 text-left"
                        onClick={() => openDuplicateMaster(row)}
                        aria-label={`${getTextbookTitle(row)} 기존 교재 열기`}
                      >
                        <span className="min-w-0 break-words">{getTextbookTitle(row)}</span>
                        <span className="text-xs text-muted-foreground">{duplicateLabel || "기존 교재"}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <div className="grid min-w-0 gap-4">
              <Field label="학교 구분" required>
                <div className="grid grid-cols-3 gap-2" role="group" aria-label="학교 구분 선택">
                  {TEXTBOOK_SCHOOL_LEVEL_OPTIONS.map((option) => (
                    <Label key={option.value} className="flex min-h-9 items-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm font-normal">
                      <Checkbox
                        checked={masterForm.schoolLevels.includes(option.value)}
                        disabled={masterForm.subject === "science"}
                        onCheckedChange={(checked) => {
                          setMasterForm((current) => {
                            const next = toggleTextbookSchoolLevel(
                              {
                                schoolLevels: current.schoolLevels as TextbookSchoolLevel[],
                                gradeLevels: current.gradeLevels as TextbookGradeLevel[],
                              },
                              option.value as TextbookSchoolLevel,
                              checked === true,
                            );
                            return { ...current, ...next };
                          });
                        }}
                      />
                      {option.label}
                    </Label>
                  ))}
                </div>

              </Field>
              <Field label="학년" required>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="group" aria-label="학년 선택">
                  {masterGradeOptions.map((option) => (
                    <Label key={option.value} className="flex min-h-9 items-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm font-normal">
                      <Checkbox
                        checked={masterForm.gradeLevels.includes(option.value)}
                        disabled={masterForm.subject === "science"}
                        onCheckedChange={(checked) => {
                          setMasterForm((current) => {
                            const next = toggleTextbookGradeLevel(
                              {
                                schoolLevels: current.schoolLevels as TextbookSchoolLevel[],
                                gradeLevels: current.gradeLevels as TextbookGradeLevel[],
                              },
                              option.value as TextbookGradeLevel,
                              checked === true,
                            );
                            return { ...current, ...next };
                          });
                        }}
                      />
                      {option.label}
                    </Label>
                  ))}
                </div>

              </Field>
            </div>
            <div className="grid min-w-0 gap-4 border-t border-border/60 pt-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><Field label={masterForm.subject === "science" ? "과학 영역" : "세부과목"} required>
                {masterForm.subject === "science" ? (
                  <SearchCombobox
                    options={scienceSubjectAreaOptions}
                    value={masterForm.subjectAreaKey}
                    onValueChange={(value) => {
                      const label = scienceSubjectAreaOptions.find((option) => option.value === value)?.label || "";
                      setMasterForm((current) => ({ ...current, subjectAreaKey: value, subSubject: label }));
                    }}
                    placeholder="과학 영역 선택"
                    searchPlaceholder="과학 영역 검색"
                    emptyLabel="활성 과학 영역이 없습니다"
                    ariaLabel="과학 영역 선택"
                  />
                ) : (
                  <SearchCombobox
                    options={masterSubSubjectOptions.map((option) => ({ value: option, label: option }))}
                    value={masterForm.subSubject}
                    onValueChange={(value) => setMasterForm((current) => ({ ...current, subSubject: value }))}
                    placeholder="세부과목 선택"
                    searchPlaceholder="세부과목 검색"
                    emptyLabel="설정된 세부과목이 없습니다"
                    ariaLabel="세부과목 선택"
                  />
                )}

              </Field></div>
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
            <div className="grid min-w-0 gap-4 border-t border-border/60 pt-4 sm:grid-cols-2">
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
        </FormDialogContent>
      </Dialog>
      ) : null}

      {purchaseDialogOpen ? (
      <Dialog open={purchaseDialogOpen} onOpenChange={(open) => (open ? setPurchaseDialogOpen(true) : closePurchaseDialog())}>
        <FormDialogContent
          returnFocusRef={dialogOpenerRef}
          title={getPurchaseDialogTitle(purchaseForm.requestStage, Boolean(selectedPurchaseLineId))}
          description="교재 요청, 주문, 입고 단계에 필요한 수량과 연결 정보를 저장합니다."
          onSubmit={submitPurchase}
          onCancel={closePurchaseDialog}
          cancelLabel="교재 요청·주문 창 닫기"
          submitLabel={selectedPurchaseLineId ? "변경 저장" : purchaseActionLabel(purchaseForm.requestStage)}
          submitDisabled={purchaseSubmitDisabled}
          busy={saving === "purchase"}
          error={actionErrorOwner === "purchase" ? actionErrorMessage : ""}
          hint={purchaseSubmitHint}
        >
            {purchaseReferenceError ? (
              <Alert role="alert"><AlertDescription className="flex items-center justify-between gap-3">
                <span>{getTextbookActionErrorMessage(purchaseReferenceError.error)}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => { void purchaseReferenceError.retry(); }}>다시 시도</Button>
              </AlertDescription></Alert>
            ) : null}
            {purchaseRequestInputMode === "catalog" && selectedBookInput && referenceData.selectedBook.loading ? (
              <div role="status" className="text-sm text-muted-foreground">선택한 교재 정보를 불러오는 중입니다.</div>
            ) : purchaseRequestInputMode === "catalog" && selectedBookInput
              && isExactAcceptedInput(referenceData.selectedBook.acceptedInput, selectedBookInput) && !acceptedSelectedBook ? (
                <Alert role="alert" variant="destructive"><AlertDescription className="flex items-center justify-between gap-3">
                  <span>선택한 교재를 사용할 수 없습니다.</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => { void referenceData.selectedBook.retry(); }}>다시 시도</Button>
                </AlertDescription></Alert>
              ) : null}
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
                        className="rounded"
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
                        className="rounded"
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
                    <div className="grid grid-cols-[minmax(0,1fr)_2.25rem] gap-2">
                      <TextbookSelect
                        value={purchaseForm.textbookId}
                        serverState={referenceData.bookOptions}
                        selectedDisplayOption={acceptedSelectedBook?.option || null}
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
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2"><Field label="수업">
                    <ClassSelect value={purchaseForm.classId} serverState={referenceData.classOptions} selectedDisplayOption={acceptedSelectedClass?.option || null} onValueChange={(value) => setPurchaseField("classId", value)} />
                  </Field></div>
                  <Field label="학생용 요청">
                    <Input value={purchaseForm.studentRequestedQuantity} onChange={(event) => setPurchaseField("studentRequestedQuantity", event.target.value)} inputMode="numeric" min="0" aria-label="학생용 요청 수량" />
                  </Field>
                  <Field label="교사용 요청">
                    <Input value={purchaseForm.teacherRequestedQuantity} onChange={(event) => setPurchaseField("teacherRequestedQuantity", event.target.value)} inputMode="numeric" min="0" aria-label="교사용 요청 수량" />
                  </Field>
                  {canManageTextbookOperations ? (
                    selectedPurchaseLineId ? (
                      <Field label="선생님">
                        <TeacherSelect
                          teachers={[]}
                          value={purchaseForm.requestBy}
                          onValueChange={(value) => setPurchaseField("requestBy", value)}
                          ariaLabel="선생님 선택"
                          serverState={referenceData.teacherOptions}
                        />
                      </Field>
                    ) : (
                      <Field label="요청자">
                        <div className="flex min-h-9 items-center break-all px-0 text-sm text-foreground">
                          {currentUserLabel || "-"}
                        </div>
                      </Field>
                    )
                  ) : (
                    <Field label="요청자">
                      <div className="flex min-h-9 items-center break-all px-0 text-sm text-foreground">
                        {currentUserLabel || "-"}
                      </div>
                    </Field>
                  )}
                  <div>
                    <Field label="위치">
                      <LocationSelect
                        locations={locations}
                        value={selectedLocationId}
                        serverState={referenceData.locationOptions}
                        selectedDisplayOption={acceptedSelectedLocation?.option || null}
                        onValueChange={(value) => setPurchaseField("locationId", value)}
                        ariaLabel="요청 위치 선택"
                      />
                    </Field>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2"><Field label="등록 교재" required>
                  <TextbookSelect
                    value={purchaseForm.textbookId}
                    serverState={referenceData.bookOptions}
                    selectedDisplayOption={acceptedSelectedBook?.option || null}
                    onValueChange={(value) => setPurchaseField("textbookId", value)}
                  />
                </Field></div>
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

                <Field label="수업">
                  <ClassSelect value={purchaseForm.classId} serverState={referenceData.classOptions} selectedDisplayOption={acceptedSelectedClass?.option || null} onValueChange={(value) => setPurchaseField("classId", value)} />
                </Field>
              </div>
            )}
            {purchaseForm.requestStage !== "request" && purchaseForm.requestedTextbookTitle ? (
              <Badge variant="outline" className="w-fit max-w-full whitespace-normal break-words rounded-md">
                요청 교재명 {purchaseForm.requestedTextbookTitle}
              </Badge>
            ) : null}
            {purchaseForm.requestStage !== "request" && (purchaseFieldVisibility.requester || purchaseFieldVisibility.location) ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {purchaseFieldVisibility.requester ? (
                  <Field label="선생님">
                    <TeacherSelect
                      teachers={[]}
                      value={purchaseForm.requestBy}
                      onValueChange={(value) => setPurchaseField("requestBy", value)}
                      ariaLabel={purchaseForm.requestStage === "order" ? "주문 요청자 선택" : "요청자 선택"}
                      serverState={referenceData.teacherOptions}
                    />
                  </Field>
                ) : null}
                {purchaseFieldVisibility.location ? (
                  <Field label="위치">
                    <LocationSelect
                      locations={locations}
                      value={selectedLocationId}
                      serverState={referenceData.locationOptions}
                      selectedDisplayOption={acceptedSelectedLocation?.option || null}
                      onValueChange={(value) => setPurchaseField("locationId", value)}
                      ariaLabel={purchaseForm.requestStage === "order" ? "주문 위치 선택" : "입고 위치 선택"}
                    />
                  </Field>
                ) : null}
              </div>
            ) : null}
            {purchaseForm.requestStage !== "request" && purchaseFieldVisibility.requestedQuantity ? (
              <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="학생용 요청">
                    <Input value={purchaseForm.studentRequestedQuantity} onChange={(event) => setPurchaseField("studentRequestedQuantity", event.target.value)} inputMode="numeric" min="0" aria-label="학생용 요청 수량" />
                  </Field>
                  <Field label="교사용 요청">
                    <Input value={purchaseForm.teacherRequestedQuantity} onChange={(event) => setPurchaseField("teacherRequestedQuantity", event.target.value)} inputMode="numeric" min="0" aria-label="교사용 요청 수량" />
                  </Field>
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
            {purchaseForm.requestStage !== "request" ? (
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
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
            <Field label="메모">
              <Textarea
                value={purchaseForm.memo}
                onChange={(event) => setPurchaseField("memo", event.target.value)}
                rows={2}
                aria-label="요청 메모"
              />
            </Field>
        </FormDialogContent>
      </Dialog>
      ) : null}

      {bulkOrderDialogOpen ? (
      <Dialog open={bulkOrderDialogOpen} onOpenChange={(open) => (open ? setBulkOrderDialogOpen(true) : closeBulkOrderDialog())}>
        <FormDialogContent
          returnFocusRef={dialogOpenerRef}
          title="선택 요청 일괄 주문"
          description="선택한 요청을 공급처 주문 단계로 한꺼번에 전환합니다."
          onSubmit={submitBulkOrder}
          onCancel={closeBulkOrderDialog}
          cancelLabel="선택 요청 일괄 주문 창 닫기"
          submitLabel="일괄 주문"
          submitDisabled={schemaDisabled || selectedBulkOrderLines.length === 0}
          busy={saving === "purchase-bulk-order"}
          error={actionErrorOwner === "purchase-bulk-order" ? actionErrorMessage : ""}
        >
            <div data-slot="bulk-order-editor" className="min-w-0">
              <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_4rem_6rem] items-center gap-4 border-b border-border/80 pb-3 text-xs font-medium text-muted-foreground sm:grid">
                <span>교재</span><span className="text-right">요청</span><span className="text-right">주문 수량</span>
              </div>
              <ul aria-label="일괄 주문 수량" className="divide-y divide-border/70">
                {selectedBulkOrderLines.map((line) => {
                  const lineId = getRecordId(line);
                  const order = getPurchaseLineOrder(line, purchaseOrdersById);
                  const draft = buildPurchaseCardDraft(line, order);
                  const references = preparedPurchaseRows.find((row) => row.memberLineIds.includes(lineId))?.references;
                  const textbook = references?.textbook;
                  const title = getPurchaseTextbookTitle(line, textbook || undefined);
                  const scopeLabel = getTextbookCopyScopeLabel(draft.copyScope);
                  const metadata = compactUniqueLabels([scopeLabel, getPublisherLabel(textbook || {}), text(references?.class?.name), text(references?.location?.name)]).join(" · ");
                  const defaultOrderQuantity = getPositivePurchaseQuantityText(draft.orderedQuantity) || draft.requestedQuantity || "1";
                  return (
                    <li key={lineId} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-x-4 gap-y-3 py-4 first:pt-0 sm:grid-cols-[minmax(0,1fr)_4rem_6rem] sm:first:pt-4">
                      <div className="col-span-2 min-w-0 sm:col-span-1">
                        <p className="break-words text-sm font-medium leading-relaxed [overflow-wrap:anywhere]">{title}</p>
                        <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{metadata}</p>
                      </div>
                      <div className="flex h-11 items-center self-end gap-2 text-sm tabular-nums sm:h-9 sm:self-center sm:justify-end" aria-label={`${title} ${scopeLabel} 요청 수량 ${formatQuantity(draft.requestedQuantity)}`}>
                        <span aria-hidden="true" className="text-xs text-muted-foreground sm:sr-only">요청</span>
                        <span>{formatQuantity(draft.requestedQuantity)}</span>
                      </div>
                      <label className="grid min-w-0 gap-1.5">
                        <span className="text-xs text-muted-foreground sm:sr-only">주문 수량</span>
                        <Input
                          value={bulkOrderQuantities[lineId] ?? defaultOrderQuantity}
                          onChange={(event) => setBulkOrderQuantity(lineId, event.target.value)}
                          inputMode="numeric"
                          min="1"
                          className="h-11 text-right tabular-nums sm:h-9"
                          aria-label={`${title} ${scopeLabel} 주문 수량`}
                        />
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
        </FormDialogContent>
      </Dialog>
      ) : null}

      {saleDialogOpen ? (
      <Dialog open={saleDialogOpen} onOpenChange={(open) => (open ? setSaleDialogOpen(true) : closeSaleDialog())}>
        <FormDialogContent
          returnFocusRef={dialogOpenerRef}
          title="출고 추가"
          description="수업 또는 선생님과 교재를 선택해 출고 대기 내역을 생성합니다."
          onSubmit={submitSale}
          onCancel={closeSaleDialog}
          cancelLabel="교재 출고 창 닫기"
          submitLabel="출고 대기 저장"
          submitDisabled={saleSubmitDisabled}
          busy={saving === "sale"}
          error={actionErrorOwner === "sale" ? actionErrorMessage : ""}
          hint={saleSubmitDisabled ? effectiveSaleSubmitHint : ""}
        >
            {saleReferenceError ? (
              <Alert role="alert"><AlertDescription className="flex items-center justify-between gap-3">
                <span>{getTextbookActionErrorMessage(saleReferenceError.error)}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => { void saleReferenceError.retry(); }}>다시 시도</Button>
              </AlertDescription></Alert>
            ) : null}
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
                  <ClassSelect value={saleForm.classId} serverState={referenceData.classOptions} selectedDisplayOption={acceptedSelectedClass?.option || null} onValueChange={(value) => {
                    setSaleField("classId", value);
                    setExcludedStudentIds([]);
                    setSaleStudentQuery("");
                  }} />
                </Field>
              ) : (
                <Field label="선생님" required>
                  <TeacherSelect
                    teachers={[]}
                    value={saleForm.teacherName}
                    onValueChange={(value) => setSaleField("teacherName", value)}
                    ariaLabel="교사용 수령 선생님 선택"
                    serverState={referenceData.teacherOptions}
                  />
                </Field>
              )}
              <Field label="교재" required>
                <TextbookSelect value={saleForm.textbookId} serverState={referenceData.bookOptions} selectedDisplayOption={acceptedSelectedBook?.option || null} onValueChange={(value) => setSaleField("textbookId", value)} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="출고월">
                <Input type="month" value={saleForm.chargeMonth} onChange={(event) => setSaleField("chargeMonth", event.target.value)} aria-label="출고월" />
              </Field>
              <Field label="위치">
                <LocationSelect locations={locations} value={saleLocationId} serverState={referenceData.locationOptions} selectedDisplayOption={acceptedSelectedLocation?.option || null} onValueChange={(value) => setSaleField("locationId", value)} ariaLabel="출고 위치 선택" />
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
                {visibleSaleStudents.length > 0 ? visibleSaleStudents.map((student, studentIndex) => {
                  const id = getRecordId(student);
                  const checked = !excludedStudentIds.includes(id);
                  const studentName = getStudentName(student);
                  return (
                    <label key={`${id}-${studentIndex}`} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
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
        </FormDialogContent>
      </Dialog>
      ) : null}


      <Dialog open={Boolean(selectedMasterDetailId && !masterDialogOpen)} onOpenChange={(open) => { if (!open) closeTextbookDetail("master"); }}>
        <DetailDialogContent title="교재 상세" description="선택한 교재의 직접 조회 결과입니다." compact={false} onClose={() => closeTextbookDetail("master")}>
          <TextbookDetailState loading={referenceData.masterDetail.loading || (!referenceData.masterDetail.error && !isExactAcceptedInput(referenceData.masterDetail.acceptedInput, selectedMasterDetailId))} error={referenceData.masterDetail.error} onRetry={referenceData.masterDetail.retry} emptyLabel="교재를 찾을 수 없습니다." />
        </DetailDialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedPurchaseDetail && !purchaseDialogOpen)} onOpenChange={(open) => { if (!open) closeTextbookDetail("purchase"); }}>
        <DetailDialogContent title="구매 상세" description="선택한 구매 건의 직접 조회 결과입니다." compact={false} onClose={() => closeTextbookDetail("purchase")}>
          <TextbookDetailState loading={referenceData.purchaseDetail.loading || (!referenceData.purchaseDetail.error && !isExactAcceptedInput(referenceData.purchaseDetail.acceptedInput, selectedPurchaseDetail))} error={referenceData.purchaseDetail.error} onRetry={referenceData.purchaseDetail.retry} emptyLabel="구매 내역을 찾을 수 없습니다." />
        </DetailDialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedSaleDetailId)} onOpenChange={(open) => { if (!open) closeTextbookDetail("sale"); }}>
        <DetailDialogContent title="출고 상세" description="선택한 출고 한 건의 직접 조회 결과입니다." onClose={() => closeTextbookDetail("sale")}>
          <TextbookDetailState loading={referenceData.saleDetail.loading || (!referenceData.saleDetail.error && !isExactAcceptedInput(referenceData.saleDetail.acceptedInput, selectedSaleDetailId))} error={referenceData.saleDetail.error} onRetry={referenceData.saleDetail.retry} emptyLabel="출고 내역을 찾을 수 없습니다.">
            {acceptedSaleDetail?.row ? (
              <dl className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-4 text-sm">
                <TextbookDetailField label="교재" value={getTextbookTitle(acceptedSaleDetail.row.textbook)} wide />
                <TextbookDetailField label="대상" value={acceptedSaleDetail.row.recipientName} wide />
                <TextbookDetailField label="구분" value={getTextbookCopyScopeLabel(getTextbookCopyScope(acceptedSaleDetail.row.line))} />
                <TextbookDetailField label="상태" value={saleStatusLabels[acceptedSaleDetail.row.status] || acceptedSaleDetail.row.status} />
                <TextbookDetailField label="수업" value={acceptedSaleDetail.row.class?.name || "—"} />
                <TextbookDetailField label="위치" value={acceptedSaleDetail.row.location?.name || "—"} />
                <TextbookDetailField label="출고월" value={acceptedSaleDetail.row.line.charge_month || "—"} />
                <TextbookDetailField label="처리일시" value={formatCompactDateTime(acceptedSaleDetail.row.eventAt)} />
                <TextbookDetailField label="수량" value={`${formatQuantity(acceptedSaleDetail.row.quantity)}권`} />
                <TextbookDetailField label="금액" value={formatCurrency(acceptedSaleDetail.row.amount)} />
                {acceptedSaleDetail.row.line.memo ? <TextbookDetailField label="메모" value={acceptedSaleDetail.row.line.memo} wide /> : null}
              </dl>
            ) : null}
          </TextbookDetailState>
        </DetailDialogContent>
      </Dialog>

      <Tabs value={activeTab} onValueChange={changeActiveTab} activationMode="manual" className="min-h-0 min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-2">
        <TabsList
          className={cn(
            "grid h-auto min-w-0 flex-1 rounded-lg bg-muted/50 p-1",
            canManageTextbookOperations ? "grid-cols-3 lg:grid-cols-6" : "grid-cols-1",
          )}
          aria-label="교재관리 업무 탭"
        >
          {canManageTextbookOperations ? (
            <TabsTrigger value="master" className={textbookTabTriggerClassName} aria-label="교재 재고">
              <BookOpen className="size-4" />
              교재 재고
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
              <TabsTrigger value="inventory" className={textbookTabTriggerClassName} aria-label="재고 실사">
                <PackageCheck className="size-4" />
                재고 실사
              </TabsTrigger>

            </>
          ) : null}
        </TabsList>
        <Button type="button" variant="ghost" size="icon" className="mt-1 size-9 shrink-0" aria-label="교재관리 새로고침" title="새로고침" onClick={refreshTextbookData} disabled={activePrimaryState.loading}>
          <RefreshCw className={cn("size-4", activePrimaryState.loading && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
        </Button>
        </div>

        <div className={cn("min-w-0", activeTab === "master" && DATA_TABLE_LAYOUT_CLASS_NAME)}>
        {activeTab === "master" ? (
          <DataTableWorkspaceToolbar
            search={<DataTableSearchField ref={masterSearchRef} value={query} onValueChange={updateMasterSearchQuery}
              label="교재 검색" clearLabel="검색 초기화" placeholder="교재명, 출판사, ISBN, 바코드" shortcut="/" />}
            feedback={listReadFeedback}
            actions={<div data-slot="textbook-master-actions" className="flex min-w-0 flex-1 items-center justify-end gap-1">{selectedTextbookRows.length > 0 ? (
              <TextbookSelectionActions selectedCount={selectedTextbookRows.length} saving={saving} metadataReady={masterOptionsAccepted}
                controlsOpen={masterBulkControlsOpen} onToggleControls={openMasterBulkDialog}
                onSetStatus={applyBulkTextbookStatus} onDelete={deleteSelectedTextbooks} onClear={() => requestLocalAction(() => { clearMasterSelection(); setMasterBulkControlsOpen(false); masterSearchRef.current?.focus({ preventScroll: true }); }, { skipConfirmation: !masterBulkDraftDirty })} />
            ) : (
            <div className="flex min-w-0 items-center justify-end gap-1">
              {activeTab === "master" ? (
                <Button type="button" variant={textbookQualityFilter === "inactive" ? "secondary" : "ghost"} size="sm" className="h-11 sm:h-9" aria-label="미사용 교재 보기" aria-pressed={textbookQualityFilter === "inactive"} onClick={() => changeTextbookQualityFilter(textbookQualityFilter === "inactive" ? "all" : "inactive")}>
                  미사용 교재
                </Button>
              ) : null}
              {activeTab === "master" && textbookQualityFilter === "inactive" && (textbookQualityFilterCounts?.inactive || 0) > 0 ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="h-11 rounded-md sm:h-9"
                  onClick={emptyInactiveTextbookTrash}
                  disabled={saving === "textbook-trash-empty"}
                >
                  <Trash2 className="mr-2 size-3.5" />
                  비우기
                </Button>
              ) : null}
              {activeTab === "master" ? (
                <Button type="button" className="h-11 shrink-0 sm:h-9" aria-label="신규 등록" onClick={openNewMasterDialog}>
                  <Plus className="mr-2 size-4" />
                  신규 등록
                </Button>
              ) : null}
            </div>
            )}</div>}
            filters={<TextbookListControls
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
          >
            <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 sm:size-9" aria-label="교재 필터 초기화" title="필터 초기화" disabled={!hasTextbookListFilter} onClick={resetTextbookListFilters}>
              <RefreshCw className="size-4" aria-hidden="true" />
            </Button>
          </TextbookListControls>}
          />
        ) : null}

        <TabsContent value="master" aria-busy={numbered.master.loading} className="m-0 grid min-w-0 content-start gap-0">
          <TextbookBulkEditDialog
            controlsOpen={masterBulkControlsOpen}
            onClose={closeMasterBulkDialog}
            returnFocusRef={dialogOpenerRef}
            error={actionErrorOwner === "textbook-bulk-edit" ? actionErrorMessage : ""}
            metadataError={referenceData.masterOptions.error ? getTextbookActionErrorMessage(referenceData.masterOptions.error) : ""}
            onRetryMetadata={() => { void referenceData.masterOptions.retry(); }}
            selectedCount={selectedTextbookRows.length}
            patch={bulkTextbookPatch}
            categoryOptions={bulkCategoryOptions}
            scienceAreaOptions={scienceSubjectAreaOptions}
            publisherOptions={publisherGroupOptions}
            saving={saving}
            metadataReady={masterOptionsAccepted}
            onPatchChange={setBulkTextbookPatchField}
            onTaxonomyEnabledChange={setBulkTextbookTaxonomyEnabled}
            onSchoolLevelChange={toggleBulkTextbookSchoolLevel}
            onGradeLevelChange={toggleBulkTextbookGradeLevel}
            onApply={applyBulkTextbookEdit}
          />

          <TextbookTable
            rows={masterVisibleInventory}
            locations={acceptedMasterSummary?.locations || []}
            summary={acceptedMasterSummary}
            onSelectTextbook={selectMasterTextbook}
            amountMode="salePrice"
            collapsedGroups={collapsedTextbookGroups}
            onToggleGroup={toggleTextbookGroup}
            selectedIds={selectedTextbookIds}
            allVisibleSelected={allVisibleTextbooksSelected}
            someVisibleSelected={someVisibleTextbooksSelected}
            onToggleAllVisible={toggleAllVisibleTextbooks}
            onBulkSelectionChange={toggleTextbookSelection}
            emptyLabel={numbered.master.loading ? "교재 재고 불러오는 중…" : numbered.master.error ? "교재 재고를 불러오지 못했습니다." : textbookEmptyLabel}
            emptyActionLabel={numbered.master.loading || numbered.master.error ? undefined : hasTextbookListFilter ? "필터 초기화" : "신규 등록"}
            onEmptyAction={numbered.master.error ? undefined : hasTextbookListFilter ? resetTextbookListFilters : openNewMasterDialog}
          />
          <div className={cn(DATA_TABLE_PAGER_CLASS_NAME, "[&>div]:w-full")}>
          <DataTablePagination
            stableDesktopLayout
            page={numbered.master.page}
            pageSize={numbered.master.pageSize}
            totalCount={numbered.master.totalCount}
            loading={numbered.master.loading}
            onPageChange={(page) => { void numbered.master.goToPage(page); }}
            onPageSizeChange={numbered.master.setPageSizePreference}
            ariaLabel="교재 재고 페이지 탐색"
          />
          </div>
        </TabsContent>

        <TabsContent value="requests" className="m-0 grid min-w-0 content-start gap-4">
          <div className={DATA_TABLE_LAYOUT_CLASS_NAME}>
          <PurchaseProcessTable
            readFeedback={listReadFeedback}
            searchControl={<DataTableSearchField ref={operationSearchRef} value={operationQuery} onValueChange={updateOperationSearchQuery} label={operationSearchLabel} placeholder={operationSearchPlaceholder} shortcut="/" />}
            mode="request"
            preparedRows={numbered.requests.rows}
            summary={numbered.requests.summary.value}
            acceptedFilters={numbered.requests.acceptedFilters}
            loading={numbered.requests.loading}
            readError={Boolean(numbered.requests.error)}
            canManageRequestLines={canManageTextbookOperations}
            orders={requestRendererData.orders}
            lines={requestRendererData.lines}
            textbooks={requestRendererData.textbooks}
            publishers={requestRendererData.publishers}
            locations={requestRendererData.locations}
            suppliers={requestRendererData.suppliers}
            publisherSupplierLinks={[]}
            classes={requestRendererData.classes}
            students={[]}
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
          <div className={cn(DATA_TABLE_PAGER_CLASS_NAME, "[&>div]:w-full")}>
          <DataTablePagination stableDesktopLayout page={numbered.requests.page} pageSize={numbered.requests.pageSize} totalCount={numbered.requests.totalCount} loading={numbered.requests.loading}
            onPageChange={(page) => { setSelectedPurchaseLineIds([]); void numbered.requests.goToPage(page); }}
            onPageSizeChange={numbered.requests.setPageSizePreference} ariaLabel="교재 요청 페이지 탐색" />
          </div>
          </div>
        </TabsContent>

        <TabsContent value="purchase" className="m-0 grid min-w-0 content-start gap-4">
          <div className={DATA_TABLE_LAYOUT_CLASS_NAME}>
          <PurchaseProcessTable
            readFeedback={listReadFeedback}
            searchControl={<DataTableSearchField ref={operationSearchRef} value={operationQuery} onValueChange={updateOperationSearchQuery} label={operationSearchLabel} placeholder={operationSearchPlaceholder} shortcut="/" />}
            mode="order"
            preparedRows={numbered.purchase.rows}
            summary={numbered.purchase.summary.value}
            acceptedFilters={numbered.purchase.acceptedFilters}
            loading={numbered.purchase.loading}
            readError={Boolean(numbered.purchase.error)}
            orders={purchaseRendererData.orders}
            lines={purchaseRendererData.lines}
            textbooks={purchaseRendererData.textbooks}
            publishers={purchaseRendererData.publishers}
            locations={purchaseRendererData.locations}
            suppliers={purchaseRendererData.suppliers}
            publisherSupplierLinks={[]}
            classes={purchaseRendererData.classes}
            students={[]}
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
          <div className={cn(DATA_TABLE_PAGER_CLASS_NAME, "[&>div]:w-full")}>
          <DataTablePagination stableDesktopLayout page={numbered.purchase.page} pageSize={numbered.purchase.pageSize} totalCount={numbered.purchase.totalCount} loading={numbered.purchase.loading}
            onPageChange={(page) => { setSelectedPurchaseLineIds([]); void numbered.purchase.goToPage(page); }}
            onPageSizeChange={numbered.purchase.setPageSizePreference} ariaLabel="주문 입고 페이지 탐색" />
          </div>
          </div>
        </TabsContent>

        <TabsContent value="sales" className="m-0 grid min-w-0 content-start gap-4">
          <div className={DATA_TABLE_LAYOUT_CLASS_NAME}>
          <SalesProcessTable
            readFeedback={listReadFeedback}
            searchControl={<DataTableSearchField ref={operationSearchRef} value={operationQuery} onValueChange={updateOperationSearchQuery} label={operationSearchLabel} placeholder={operationSearchPlaceholder} shortcut="/" />}
            summary={numbered.sales.summary.value}
            acceptedFilters={numbered.sales.acceptedFilters}
            loading={numbered.sales.loading}
            readError={Boolean(numbered.sales.error)}
            sales={saleRendererData.sales}
            lines={saleRendererData.lines}
            textbooks={saleRendererData.textbooks}
            classes={saleRendererData.classes}
            students={saleRendererData.students}
            locations={saleRendererData.locations}
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
            onInspectSale={(line) => navigateToTextbookDetail("sale", getRecordId(line))}
            onClearSearch={() => updateOperationSearchQuery("")}
          />
          <div className={cn(DATA_TABLE_PAGER_CLASS_NAME, "[&>div]:w-full")}>
          <DataTablePagination stableDesktopLayout page={numbered.sales.page} pageSize={numbered.sales.pageSize} totalCount={numbered.sales.totalCount} loading={numbered.sales.loading}
            onPageChange={(page) => { setSelectedSaleLineIds([]); void numbered.sales.goToPage(page); }}
            onPageSizeChange={numbered.sales.setPageSizePreference} ariaLabel="교재 출고 페이지 탐색" />
          </div>
          </div>
          {numbered.saleHistory.summary.value?.sourceTotalCount !== 0 || numbered.saleHistory.error || numbered.saleHistory.summary.error ? <>
          <SalesHistoryLedger
            loading={numbered.saleHistory.loading}
            readError={Boolean(numbered.saleHistory.error || numbered.saleHistory.summary.error)}
            readFeedback={numbered.saleHistory.error || numbered.saleHistory.summary.error ? <DataTableReadFeedback label="출고 이력 조회 실패"
              message={getTextbookActionErrorMessage(numbered.saleHistory.error || numbered.saleHistory.summary.error)} retryLabel="출고 이력 다시 시도"
              onRetry={() => Promise.all([numbered.saleHistory.retry(), numbered.saleHistory.summary.retry()])} /> : null}
            rows={numbered.saleHistory.rows}
            summary={numbered.saleHistory.summary.value}
            filters={saleHistoryFilters}
            onFiltersChange={setSaleHistoryFilters}
          />
          <DataTablePagination page={numbered.saleHistory.page} pageSize={numbered.saleHistory.pageSize} totalCount={numbered.saleHistory.totalCount} loading={numbered.saleHistory.loading}
            onPageChange={(page) => { void numbered.saleHistory.goToPage(page); }}
            onPageSizeChange={numbered.saleHistory.setPageSizePreference} ariaLabel="출고 이력 페이지 탐색" />
          </> : null}

        </TabsContent>

        <TabsContent value="inventory" className="m-0 grid min-w-0 content-start gap-4">
          <div className={DATA_TABLE_LAYOUT_CLASS_NAME}>
          <InventoryCountWorkspace
            readFeedback={listReadFeedback}
            searchControl={<DataTableSearchField ref={masterSearchRef} value={query} onValueChange={updateMasterSearchQuery}
              label="교재 검색" clearLabel="검색 초기화" placeholder="교재명, 출판사, ISBN, 바코드" shortcut="/" />}
            classificationControls={(locationControl) => <TextbookListControls extraFilters={locationControl}
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
          >
            <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 sm:size-9" aria-label="교재 필터 초기화" title="필터 초기화" disabled={!hasTextbookListFilter} onClick={resetTextbookListFilters}>
              <RefreshCw className="size-4" aria-hidden="true" />
            </Button>
          </TextbookListControls>}
            rows={numbered.inventory.rows}
            loading={numbered.inventory.loading || (!inventoryLocationReference.ready && !inventoryLocationReference.error)}
            readError={Boolean(numbered.inventory.error || inventoryLocationReference.error)}
            summary={numbered.inventory.summary.value}
            locations={numbered.inventory.summary.value?.locations || inventoryLocationReference.locations}
            locationId={selectedInventoryCountLocationId}
            countDrafts={inventoryCountDrafts}
            memoDrafts={inventoryCountMemoDrafts}
            selectedIds={selectedTextbookIds}
            saving={saving}
            schemaDisabled={schemaDisabled}
            collapsedGroups={collapsedTextbookGroups}
            onToggleGroup={toggleTextbookGroup}
            onLocationChange={selectInventoryCountLocation}
            onDraftChange={setInventoryCountDraft}
            onMemoChange={setInventoryCountMemoDraft}
            onClearDraft={clearInventoryCountDraft}
            onSubmitCount={submitInlineStockCount}
            onToggleSelection={toggleTextbookSelection}
            onToggleVisibleSelection={toggleVisibleTextbookIds}
            onSubmitBulkCount={submitBulkInlineStockCounts}
            emptyLabel={textbookEmptyLabel}
          />
          <div className={cn(DATA_TABLE_PAGER_CLASS_NAME, "[&>div]:w-full")}>
          <DataTablePagination
            page={numbered.inventory.page}
            pageSize={numbered.inventory.pageSize}
            totalCount={numbered.inventory.totalCount}
            loading={numbered.inventory.loading}
            onPageChange={(page) => { setSelectedTextbookIds([]); void numbered.inventory.goToPage(page); }}
            onPageSizeChange={numbered.inventory.setPageSizePreference}
            ariaLabel="재고 실사 페이지 탐색"
          />
          </div>
          </div>
          <div className={DATA_TABLE_LAYOUT_CLASS_NAME}>
          <InventoryHistoryPanel
            readFeedback={numbered.inventoryHistory.error ? <DataTableReadFeedback label="재고 이력 조회 실패"
              message={getTextbookActionErrorMessage(numbered.inventoryHistory.error)} retryLabel="재고 이력 다시 시도" onRetry={numbered.inventoryHistory.retry} /> : null}
            rows={numbered.inventoryHistory.rows}
            loading={numbered.inventoryHistory.loading || (!inventoryLocationReference.ready && !inventoryLocationReference.error)}
            readError={Boolean(numbered.inventoryHistory.error || inventoryLocationReference.error)}
            currentUserId={currentUserId}
            currentUserLabel={currentUserLabel}
            canDeleteHistory={canDeleteTextbookHistory}
            saving={saving}
            onDeleteHistory={deleteInventoryHistory}
          />
          <div className={cn(DATA_TABLE_PAGER_CLASS_NAME, "[&>div]:w-full")}>
          <DataTablePagination
            page={numbered.inventoryHistory.page}
            pageSize={numbered.inventoryHistory.pageSize}
            totalCount={numbered.inventoryHistory.totalCount}
            loading={numbered.inventoryHistory.loading}
            onPageChange={(page) => { void numbered.inventoryHistory.goToPage(page); }}
            onPageSizeChange={numbered.inventoryHistory.setPageSizePreference}
            ariaLabel="재고 이력 페이지 탐색"
          />
          </div>
          </div>
        </TabsContent>

        </div>
      </Tabs>
    </div>
  );
}

function TextbookDetailState({ loading, error, onRetry, emptyLabel, children }: {
  loading: boolean; error: unknown; onRetry: () => unknown; emptyLabel: string; children?: React.ReactNode;
}) {
  if (loading) return <p role="status" className="text-sm text-muted-foreground">상세 정보를 불러오는 중입니다.</p>;
  if (error) return <Alert role="alert"><AlertDescription className="flex flex-wrap items-center justify-between gap-3">
    <span className="min-w-0 break-words">{getTextbookActionErrorMessage(error)}</span>
    <Button type="button" variant="outline" size="sm" onClick={() => { void onRetry(); }}>다시 시도</Button>
  </AlertDescription></Alert>;
  return children || <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
}

function TextbookDetailField({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <div className={cn("min-w-0 space-y-1.5", wide && "col-span-2")}>
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="whitespace-pre-wrap break-words font-medium">{value}</dd>
  </div>;
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
  loadState = "",
  sourceLineCount = 0,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  groups: TextbookHandoffGroup[];
  emptyLabel: string;
  idPrefix: string;
  format?: "default" | "purchase-order" | "purchase-return";
  loadState?: string;
  sourceLineCount?: number;
  onRetry?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const exportAbortRef = useRef<AbortController | null>(null);
  const copyEpochRef = useRef(0);
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

  function resetFeedback() {
    copyEpochRef.current += 1;
    exportAbortRef.current?.abort();
    exportAbortRef.current = null;
    if (preparedDownloadRef.current) URL.revokeObjectURL(preparedDownloadRef.current.url);
    preparedDownloadRef.current = null;
    setPreparedDownload(null);
    setBusy(false);
    setStatus("");
    setManualCopyText("");
  }

  useEffect(() => {
    resetFeedback();
    return () => {
      copyEpochRef.current += 1;
      exportAbortRef.current?.abort();
      if (preparedDownloadRef.current) URL.revokeObjectURL(preparedDownloadRef.current.url);
      preparedDownloadRef.current = null;
    };
  }, [open, groups]);

  async function runCopyAction(value: string, successStatus: string) {
    const epoch = copyEpochRef.current;
    try {
      await writeClipboardText(value);
      if (copyEpochRef.current !== epoch) return;
      setManualCopyText("");
      setStatus(successStatus);
    } catch {
      if (copyEpochRef.current !== epoch) return;
      setManualCopyText(value);
      setStatus("자동 복사가 제한되어 메시지를 선택했습니다.");
    }
  }

  function setNextPreparedDownload(download: PreparedHandoffDownload) {
    if (preparedDownloadRef.current) {
      URL.revokeObjectURL(preparedDownloadRef.current.url);
    }
    preparedDownloadRef.current = download;
    setPreparedDownload(download);
  }

  async function runDownloadAction(action: (signal: AbortSignal) => Promise<PreparedHandoffDownload>, successStatus: string) {
    if (exportAbortRef.current) return;
    const abort = new AbortController();
    exportAbortRef.current = abort;
    setBusy(true);
    setStatus("파일을 준비하고 있습니다.");
    try {
      const download = await action(abort.signal);
      if (abort.signal.aborted) { URL.revokeObjectURL(download.url); return; }
      setNextPreparedDownload(download);
      setStatus(successStatus);
    } catch {
      if (!abort.signal.aborted) setStatus("파일을 만들지 못했습니다. 저장 메뉴에서 다시 시도하세요.");
    } finally {
      if (exportAbortRef.current === abort) {
        exportAbortRef.current = null;
        setBusy(false);
      }
    }
  }

  function closeDialog() {
    resetFeedback();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => nextOpen ? onOpenChange(true) : closeDialog()}>
      <DocumentDialogContent
        title={title}
        description={description}
        onClose={closeDialog}
        toolbar={(
          <div className="flex flex-wrap items-center justify-between gap-3" data-handoff-toolbar>
            <p className="text-sm text-muted-foreground tabular-nums">
              {formatQuantity(sourceLineCount)}건 · {formatQuantity(groups.length)}묶음 · {formatQuantity(totalQuantity)}권
            </p>
            <div className="flex items-center gap-2">
              {allowsTextCopy ? (
                <Button type="button" size="sm" variant="outline" disabled={groups.length === 0 || busy} onClick={() => runCopyAction(allText, "전체 복사됨")}>
                  <Copy />전체 복사
                </Button>
              ) : null}
              <HandoffExportMenu label="전체 저장" ariaLabel="전체 문서 저장 메뉴" disabled={groups.length === 0 || busy} busy={busy}
                onImage={() => runDownloadAction((signal) => downloadHandoffImage(getHandoffCaptureElement(allDomId), title, signal), "전체 이미지 저장됨")}
                onPdf={() => runDownloadAction((signal) => downloadHandoffPdf(getHandoffCaptureElement(allDomId), title, signal), "PDF 저장됨")}
              />
            </div>
          </div>
        )}
        feedback={status || (groups.length ? loadState : "")}
        actions={preparedDownload ? (
          <Button type="button" asChild>
            <a href={preparedDownload.url} download={preparedDownload.filename} title={`${preparedDownload.label} 파일 준비됨 · ${preparedDownload.filename}`}>
              <Save />파일 다시 저장
            </a>
          </Button>
        ) : null}
      >
        <div className="grid min-w-0 gap-4">
          {allowsTextCopy && manualCopyText ? (
            <div className="grid min-w-0 gap-2 rounded-md border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={`${idPrefix}-manual-copy`} className="text-sm font-medium">복사할 메시지</label>
                <Button type="button" size="sm" variant="outline" onClick={() => {
                  manualCopyTextareaRef.current?.focus();
                  manualCopyTextareaRef.current?.select();
                }}>전체 선택</Button>
              </div>
              <Textarea ref={manualCopyTextareaRef} id={`${idPrefix}-manual-copy`} readOnly aria-label="복사할 청구 메시지"
                className="max-h-40 min-h-24 resize-y font-mono text-xs" value={manualCopyText} />
            </div>
          ) : null}
          {groups.length === 0 ? (
            <div className="grid justify-items-center gap-4 py-12 text-center text-sm text-muted-foreground">
              <p role="status">{loadState || emptyLabel}</p>
              {onRetry ? <Button type="button" size="sm" variant="outline" onClick={onRetry}><RefreshCw />다시 불러오기</Button> : null}
            </div>
          ) : (
            <div id={allDomId} data-handoff-scroll className="min-w-0 overflow-x-auto overscroll-contain">
              <div data-handoff-capture-target data-handoff-print-root className="grid gap-3 bg-white">
                {groups.map((group) => {
                  const groupDomId = getHandoffDomId(idPrefix, group.id);
                  const filename = `${title}-${group.title}`;
                  const purchaseOrderLocations = isPurchaseDocument ? getPurchaseOrderLocations(group) : [];
                  return (
                    <section key={group.id} className="grid min-w-0 gap-2 rounded-md border bg-background p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3" data-handoff-toolbar>
                        <div className="min-w-0 flex-1">
                          <div className="break-words text-sm font-semibold">{group.title}</div>
                          <div className="break-words text-xs text-muted-foreground">{group.summary.join(" · ")}</div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          {allowsTextCopy ? (
                            <Button type="button" size="sm" variant="outline" disabled={busy} aria-label={`${group.title} 메시지 복사`}
                              onClick={() => runCopyAction(group.message, "복사됨")}><Copy />복사</Button>
                          ) : null}
                          <HandoffExportMenu label="저장" ariaLabel={`${group.title} 문서 저장 메뉴`} disabled={busy}
                            onImage={() => runDownloadAction((signal) => downloadHandoffImage(getHandoffCaptureElement(groupDomId), filename, signal), "이미지 저장됨")}
                            onPdf={() => runDownloadAction((signal) => downloadHandoffPdf(getHandoffCaptureElement(groupDomId), filename, signal), "PDF 저장됨")}
                          />
                        </div>
                      </div>

                      <div id={groupDomId} data-handoff-card data-handoff-capture-target data-handoff-print-root className="min-w-0 rounded-md bg-white p-4 text-slate-950">
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
                        <div role="region" aria-label={`${group.title} 문서 표`} tabIndex={0} className="mt-3 overflow-x-auto rounded-md border border-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-ring [&>[data-slot=table-container]]:overflow-visible">
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
      </DocumentDialogContent>
    </Dialog>
  );
}

function HandoffExportMenu({ label, ariaLabel, disabled, busy = false, onImage, onPdf }: {
  label: string; ariaLabel: string; disabled: boolean; busy?: boolean; onImage: () => void; onPdf: () => void;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="outline" disabled={disabled} aria-label={ariaLabel}>
          {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Save />}
          {label}<ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onImage}><FileImage />이미지 저장</DropdownMenuItem>
        <DropdownMenuItem onSelect={onPdf}><Printer />PDF 저장</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SearchCombobox({
  options,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  ariaLabel,
  triggerLabel,
  triggerId,
  triggerClassName,
  contentClassName,
  allowDeselect = false,
  filterGroups = [],
  filterLayout = "default",
  serverState,
  selectedDisplayOption,
}: {
  options: SearchSelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  ariaLabel: string;
  triggerLabel?: string;
  triggerId?: string;
  triggerClassName?: string;
  contentClassName?: string;
  allowDeselect?: boolean;
  filterGroups?: SearchSelectFilterGroup[];
  filterLayout?: SearchSelectFilterLayout;
  serverState?: TextbookReferencePickerState;
  selectedDisplayOption?: SearchSelectOption | null;
}) {
  const [open, setOpen] = useState(false);
  const [selectedFilterValues, setSelectedFilterValues] = useState<Record<string, string[]>>({});
  const selected = options.find((option) => option.value === value) || (selectedDisplayOption?.value === value ? selectedDisplayOption : undefined);
  const effectiveFilterGroups = serverState?.baseFilterGroups || filterGroups;
  const effectiveSelectedFilterValues = serverState?.selectedFilters || selectedFilterValues;
  const activeFilterCount = serverState?.activeFilterCount ?? effectiveFilterGroups.reduce((sum, group) => {
    const validValues = new Set(group.options.map((option) => option.value));
    return sum + (effectiveSelectedFilterValues[group.key] || []).filter((value) => validValues.has(value)).length;
  }, 0);
  const visibleFilterGroups = serverState?.visibleFilterGroups || buildVisibleSearchSelectFilterGroups(options, effectiveFilterGroups, effectiveSelectedFilterValues);
  const filteredOptions = serverState ? options : filterGroups.length === 0
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
          id={triggerId}
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn("w-full justify-between gap-2 px-3 font-normal", triggerClassName)}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            {triggerLabel ? <span className="shrink-0 text-xs font-medium text-muted-foreground">{triggerLabel}</span> : null}
            <span className={cn("min-w-0 truncate", !selected && "text-muted-foreground")}>
              {selected?.label || (serverState && value ? "선택 항목을 찾을 수 없습니다" : placeholder)}
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
        <Command shouldFilter={serverState ? false : undefined}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={serverState?.search}
            onValueChange={serverState ? serverState.setSearch : undefined}
          />
          {visibleFilterGroups.length > 0 ? (
            <div className="grid gap-2 border-b px-2 py-2">
              {!usesTwoColumnFilterLayout && activeFilterCount > 0 ? (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-md px-2 text-xs"
                    onClick={() => serverState ? serverState.setSelectedFilters({}) : setSelectedFilterValues({})}
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
                          const isFilterSelected = (effectiveSelectedFilterValues[group.key] || []).includes(option.value);
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
                                const next = toggleSearchSelectFilter(effectiveSelectedFilterValues, group.key, option.value);
                                if (serverState) serverState.setSelectedFilters(next);
                                else setSelectedFilterValues(next);
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
                          onClick={() => serverState ? serverState.setSelectedFilters({}) : setSelectedFilterValues({})}
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
            <CommandEmpty>{serverState?.loading ? "불러오는 중" : emptyLabel}</CommandEmpty>
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
            {serverState ? (
              <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t bg-background px-2 py-2" aria-label={`${ariaLabel} 서버 페이지`}>
                <Button type="button" variant="outline" size="sm" disabled={serverState.loading || serverState.page <= 1} onClick={() => { void serverState.goToPage(serverState.page - 1); }}>이전</Button>
                <span className="text-xs text-muted-foreground">{formatQuantity(serverState.page)} / {formatQuantity(Math.max(1, Math.ceil((serverState.totalCount || 0) / serverState.pageSize)))}</span>
                {serverState.error ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => { void serverState.retry(); }}>다시 시도</Button>
                ) : (
                  <Button type="button" variant="outline" size="sm" disabled={serverState.loading || serverState.totalCount === null || serverState.page * serverState.pageSize >= serverState.totalCount} onClick={() => { void serverState.goToPage(serverState.page + 1); }}>다음</Button>
                )}
              </div>
            ) : null}
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

function TextbookSelect({ textbooks = [], value, onValueChange, serverState, selectedDisplayOption }: { textbooks?: Row[]; value: string; onValueChange: (value: string) => void; serverState?: TextbookReferencePickerState; selectedDisplayOption?: SearchSelectOption | null }) {
  // Pre-science selector contract: { key: "subject", label: "과목", optionOrder: ["영어", "수학", "기타"] }
  const options = serverState?.rows || buildTextbookReferenceOptions(textbooks);
  const textbookSelectFilterGroups = buildSearchSelectFilterGroups(options, [
    { key: "subject", label: "과목", optionOrder: ["영어", "수학", "과학", "기타"] },
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
      serverState={serverState}
      selectedDisplayOption={selectedDisplayOption}
    />
  );
}

function ClassSelect({ classes = [], value, onValueChange, serverState, selectedDisplayOption }: { classes?: Row[]; value: string; onValueChange: (value: string) => void; serverState?: TextbookReferencePickerState; selectedDisplayOption?: SearchSelectOption | null }) {
  // Pre-science selector contract: { key: "subject", label: "과목", optionOrder: ["영어", "수학", "기타"] }
  const options = serverState?.rows || buildTextbookClassReferenceOptions(classes);
  const classSelectFilterGroups = buildSearchSelectFilterGroups(options, [
    { key: "subject", label: "과목", optionOrder: ["영어", "수학", "과학", "기타"] },
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
      serverState={serverState}
      selectedDisplayOption={selectedDisplayOption}
    />
  );
}

function TeacherSelect({
  teachers,
  value,
  onValueChange,
  ariaLabel = "선생님 선택",
  serverState,
}: {
  teachers: Row[];
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel?: string;
  serverState?: TextbookReferencePickerState;
}) {
  const teacherNames = [...new Set((serverState ? serverState.rows.map((option) => option.label) : teachers.map(getTeacherName)).filter(Boolean))];
  if (!serverState) teacherNames.sort((left, right) => left.localeCompare(right, "ko"));
  const hasCustomValue = Boolean(value) && !teacherNames.includes(value);

  if (!serverState) {
    return (
      <Select value={value || "none"} onValueChange={(next) => onValueChange(next === "none" ? "" : next)}>
        <SelectTrigger aria-label={ariaLabel}><SelectValue placeholder="선생님 선택" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">미지정</SelectItem>
          {hasCustomValue ? <SelectItem value={value}>{value}</SelectItem> : null}
          {teacherNames.map((teacher) => <SelectItem key={teacher} value={teacher}>{teacher}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }

  return (
    <SearchCombobox
      options={[...(hasCustomValue ? [{ value, label: value }] : []), ...teacherNames.map((teacher) => ({ value: teacher, label: teacher }))]}
      value={value}
      onValueChange={onValueChange}
      placeholder="선생님 선택"
      searchPlaceholder="선생님 검색"
      emptyLabel="선생님이 없습니다"
      ariaLabel={ariaLabel}
      allowDeselect={true}
      serverState={serverState}
      selectedDisplayOption={hasCustomValue ? { value, label: value } : null}
    />
  );
}

function LocationSelect({
  locations,
  value,
  onValueChange,
  ariaLabel = "위치 선택",
  serverState,
  selectedDisplayOption,
}: {
  locations: Row[];
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel?: string;
  serverState?: TextbookReferencePickerState;
  selectedDisplayOption?: SearchSelectOption | null;
}) {
  return (
    <SearchCombobox
      options={serverState?.rows || locations.map((location) => ({ value: getRecordId(location), label: text(location.name || location.code), searchText: text(location.code) }))}
      value={value}
      onValueChange={onValueChange}
      placeholder="위치"
      searchPlaceholder="위치 검색"
      emptyLabel="위치가 없습니다"
      ariaLabel={ariaLabel}
      serverState={serverState}
      selectedDisplayOption={selectedDisplayOption}
    />
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
  children,
  extraFilters,
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
  children?: React.ReactNode;
  extraFilters?: React.ReactNode;
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
    <div className="flex min-w-0 items-end gap-1 lg:items-center">
    <DataTableFilters aria-label="교재 분류 필터" className="min-w-0 flex-1 sm:grid sm:grid-cols-2 lg:flex lg:flex-nowrap">
      <DataTableSelectFilter inline id="textbook-subject-filter" label="과목" ariaLabel="교재 과목 필터"
        value={subjectFilter} options={subjectSelectOptions} onValueChange={onSubjectFilterChange} />
      <div className="grid min-w-0 gap-1.5 lg:flex lg:flex-1 lg:items-center lg:gap-2">
        <Label htmlFor="textbook-category-filter" className="shrink-0 text-xs text-muted-foreground">세부과목</Label>
        <SearchCombobox options={categorySelectOptions} value={categoryFilter} onValueChange={onCategoryFilterChange}
          placeholder="전체 세부과목" searchPlaceholder="세부과목 검색" emptyLabel="세부과목이 없습니다"
          ariaLabel="교재 세부과목 필터" triggerId="textbook-category-filter"
          triggerClassName="h-11 min-w-0 flex-1 rounded-md sm:h-9" contentClassName="w-[min(22rem,calc(100vw-2rem))]" />
      </div>
      <DataTableSelectFilter inline id="textbook-school-level-filter" label="학교" ariaLabel="교재 학교 구분 필터"
        value={schoolLevelFilter} options={schoolLevelSelectOptions} onValueChange={onSchoolLevelFilterChange} />
      <DataTableSelectFilter inline id="textbook-grade-level-filter" label="학년" ariaLabel="교재 학년 필터"
        value={gradeLevelFilter} options={gradeLevelSelectOptions} onValueChange={onGradeLevelFilterChange} />
      {extraFilters}
    </DataTableFilters>
    {children}
    </div>
  );
}

function TextbookSelectionActions({ selectedCount, saving, metadataReady, controlsOpen, onToggleControls, onSetStatus, onDelete, onClear }: {
  selectedCount: number;
  saving: string;
  metadataReady: boolean;
  controlsOpen: boolean;
  onToggleControls: () => void;
  onSetStatus: (status: string) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div role="region" aria-label="선택한 교재 일괄 작업" className="flex min-w-0 flex-1 items-center justify-end gap-1">
      <span className="mr-auto whitespace-nowrap text-sm font-medium tabular-nums" role="status">{formatQuantity(selectedCount)}개 선택</span>
      <Button type="button" size="sm" variant={controlsOpen ? "secondary" : "outline"} className="h-11 shrink-0 sm:h-9"
        aria-expanded={controlsOpen} aria-haspopup="dialog" disabled={!metadataReady} onClick={onToggleControls}>속성 변경</Button>
      <DataTableRowActions label="선택 교재 작업">
        <DropdownMenuItem disabled={saving === "textbook-bulk-status"} aria-label="선택 교재 사용 전환" onSelect={() => onSetStatus("active")}><Check />사용 전환</DropdownMenuItem>
        <DropdownMenuItem disabled={saving === "textbook-bulk-status"} aria-label="선택 교재 미사용 처리" onSelect={() => onSetStatus("inactive")}><X />미사용 처리</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={saving === "textbook-bulk-delete"} aria-label="선택 교재 삭제"
          title="이력이 없는 교재는 삭제, 이력이 있는 교재는 미사용 전환" onSelect={onDelete}><Trash2 />삭제</DropdownMenuItem>
      </DataTableRowActions>
      <Button type="button" size="icon" variant="ghost" className="size-11 shrink-0 sm:size-9" aria-label="선택 교재 선택 해제" title="선택 해제" onClick={onClear}><X className="size-4" /></Button>
    </div>
  );
}

function TextbookBulkEditDialog({
  controlsOpen,
  onClose,
  returnFocusRef,
  error,
  metadataError,
  onRetryMetadata,
  selectedCount,
  patch,
  categoryOptions,
  scienceAreaOptions,
  publisherOptions,
  saving,
  metadataReady,
  onPatchChange,
  onTaxonomyEnabledChange,
  onSchoolLevelChange,
  onGradeLevelChange,
  onApply,
}: {
  controlsOpen: boolean;
  onClose: () => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  error: string;
  metadataError: string;
  onRetryMetadata: () => void;
  selectedCount: number;
  patch: typeof emptyBulkTextbookPatch;
  categoryOptions: string[];
  scienceAreaOptions: Array<{ value: string; label: string }>;
  publisherOptions: string[];
  saving: string;
  metadataReady: boolean;
  onPatchChange: (name: keyof typeof emptyBulkTextbookPatch, value: string) => void;
  onTaxonomyEnabledChange: (enabled: boolean) => void;
  onSchoolLevelChange: (value: TextbookSchoolLevel, checked: boolean) => void;
  onGradeLevelChange: (value: TextbookGradeLevel, checked: boolean) => void;
  onApply: () => void;
}) {
  if (selectedCount === 0 || !controlsOpen) {
    return null;
  }

  const hasPatch =
    patch.subject !== "keep" ||
    Boolean(patch.subjectAreaKey) ||
    patch.schoolLevels !== null ||
    patch.gradeLevels !== null ||
    Boolean(text(patch.category)) ||
    Boolean(text(patch.publisher)) ||
    Boolean(text(patch.price)) ||
    patch.status !== "keep";
  const taxonomyEnabled = patch.schoolLevels !== null && patch.gradeLevels !== null;
  const taxonomyValid = (!taxonomyEnabled || Boolean(patch.schoolLevels?.length && patch.gradeLevels?.length))
    && (patch.subject !== "science" || Boolean(patch.subjectAreaKey));
  const bulkGradeOptions = taxonomyEnabled
    ? TEXTBOOK_GRADE_OPTIONS.filter((option) => patch.schoolLevels?.includes(option.schoolLevel))
    : [];

  return (
    <Dialog open={controlsOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <FormDialogContent
        title="선택 교재 속성 변경"
        description="선택한 교재에 입력한 속성만 적용합니다. 유지한 항목은 바뀌지 않습니다."
        returnFocusRef={returnFocusRef}
        onSubmit={(event) => { event.preventDefault(); onApply(); }}
        onCancel={onClose}
        cancelLabel="선택 교재 속성 변경 취소"
        submitLabel="변경 저장"
        submitAriaLabel="선택 교재 변경 저장"
        submitDisabled={!metadataReady || !hasPatch || !taxonomyValid}
        busy={saving === "textbook-bulk-edit"}
        error={error}
        hint={!metadataReady ? "교재 분류를 불러온 뒤 변경할 수 있습니다." : !hasPatch ? "변경할 항목을 입력하세요." : patch.subject === "science" && !patch.subjectAreaKey ? "과학 영역을 선택하세요." : !taxonomyValid ? "학교 구분과 학년을 하나 이상 선택하세요." : `${formatQuantity(selectedCount)}개 교재에 입력한 변경사항을 적용합니다.`}
      >
        <p className="text-sm font-medium tabular-nums">{formatQuantity(selectedCount)}개 교재 선택</p>
        {metadataError ? <Alert variant="destructive"><AlertDescription className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 break-words">{metadataError}</span>
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onRetryMetadata}>다시 시도</Button>
        </AlertDescription></Alert> : null}
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field label="과목">
            <Select value={patch.subject} onValueChange={(value) => onPatchChange("subject", value)}>
              <SelectTrigger className="w-full data-[size=default]:h-11 sm:data-[size=default]:h-9" aria-label="일괄 과목 선택"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="keep">과목 유지</SelectItem>
                {subjectOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={patch.subject === "science" ? "과학 영역" : "세부과목"}>
            {patch.subject === "science" ? (
              <SearchCombobox
                triggerClassName="h-11 sm:h-9"
                options={scienceAreaOptions}
                value={patch.subjectAreaKey}
                onValueChange={(value) => onPatchChange("subjectAreaKey", value)}
                placeholder="과학 영역 선택"
                searchPlaceholder="과학 영역 검색"
                emptyLabel="활성 과학 영역이 없습니다"
                ariaLabel="일괄 과학 영역"
              />
            ) : (
              <SearchCombobox
                triggerClassName="h-11 sm:h-9"
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
            )}
          </Field>
          <Field label="출판사">
            <Input
              value={patch.publisher}
              onChange={(event) => onPatchChange("publisher", event.target.value)}
              list="textbook-publisher-options"
              placeholder={publisherOptions.length > 0 ? "유지 또는 선택" : "유지"}
              className="h-11 w-full sm:h-9"
              aria-label="일괄 출판사"
            />
          </Field>
          <Field label="판매가">
            <Input value={patch.price} onChange={(event) => onPatchChange("price", normalizeMoneyInput(event.target.value))} placeholder="예: 12000" className="h-11 w-full sm:h-9" inputMode="numeric" pattern="[0-9]*" aria-label="일괄 판매가" />
          </Field>
          <Field label="상태">
            <Select value={patch.status} onValueChange={(value) => onPatchChange("status", value)}>
              <SelectTrigger className="w-full data-[size=default]:h-11 sm:data-[size=default]:h-9" aria-label="일괄 상태 선택"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="keep">상태 유지</SelectItem>
                {statusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <fieldset className="grid min-w-0 gap-3 border-t pt-4 sm:col-span-2">
            <Label className="flex min-h-11 items-center gap-2 text-sm font-medium sm:min-h-9">
              <Checkbox
                checked={taxonomyEnabled}
                disabled={patch.subject === "science"}
                onCheckedChange={(checked) => onTaxonomyEnabledChange(checked === true)}
              />
              학교·학년 변경
            </Label>
            {taxonomyEnabled ? (
              <div className="grid min-w-0 gap-4">
                <div className="grid gap-1" role="group" aria-label="일괄 학교 구분 선택">
                  <span className="text-xs font-medium">학교 구분</span>
                  <div className="grid grid-cols-3 gap-2">
                    {TEXTBOOK_SCHOOL_LEVEL_OPTIONS.map((option) => (
                      <Label key={option.value} className="flex min-h-11 min-w-0 items-center gap-2 rounded-md border px-3 text-sm font-normal has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-accent sm:min-h-9">
                        <Checkbox
                          checked={patch.schoolLevels?.includes(option.value)}
                          disabled={patch.subject === "science"}
                          onCheckedChange={(checked) => onSchoolLevelChange(option.value as TextbookSchoolLevel, checked === true)}
                        />
                        {option.label}
                      </Label>
                    ))}
                  </div>
                  {patch.schoolLevels?.length === 0 ? <p className="text-xs text-destructive">학교 구분을 하나 이상 선택하세요.</p> : null}
                </div>
                <div className="grid gap-1" role="group" aria-label="일괄 학년 선택">
                  <span className="text-xs font-medium">학년</span>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {bulkGradeOptions.map((option) => (
                      <Label key={option.value} className="flex min-h-11 min-w-0 items-center gap-2 rounded-md border px-3 text-sm font-normal has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-accent sm:min-h-9">
                        <Checkbox
                          checked={patch.gradeLevels?.includes(option.value)}
                          disabled={patch.subject === "science"}
                          onCheckedChange={(checked) => onGradeLevelChange(option.value as TextbookGradeLevel, checked === true)}
                        />
                        {option.label}
                      </Label>
                    ))}
                  </div>
                  {patch.gradeLevels?.length === 0 ? <p className="text-xs text-destructive">학년을 하나 이상 선택하세요.</p> : null}
                </div>
              </div>
            ) : null}
          </fieldset>
        </div>
      </FormDialogContent>
    </Dialog>
  );
}

function getInventoryCountReasonLabel(row: InventoryCountRow) {
  const latestLabel = row.latestCountAt ? `최근 실사 ${formatCompactDateTime(row.latestCountAt)}` : "실사 이력 없음";
  return latestLabel;
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
  searchControl,
  readFeedback,
  classificationControls,
  rows,
  summary,
  locations,
  locationId,
  countDrafts,
  memoDrafts,
  selectedIds = [],
  saving,
  schemaDisabled,
  collapsedGroups = [],
  onToggleGroup,
  onLocationChange,
  onDraftChange,
  onMemoChange,
  onClearDraft,
  onSubmitCount,
  onToggleSelection,
  onToggleVisibleSelection,
  onSubmitBulkCount,
  loading = false,
  readError = false,
  emptyLabel = "교재가 없습니다",
}: {
  searchControl?: React.ReactNode;
  readFeedback?: React.ReactNode;
  classificationControls?: (locationControl: React.ReactNode) => React.ReactNode;
  rows: InventoryCountRow[];
  summary: TextbookInventorySummary | null;
  locations: Row[];
  locationId: string;
  countDrafts: Record<string, string>;
  memoDrafts: Record<string, string>;
  selectedIds?: string[];
  saving: string;
  schemaDisabled: boolean;
  collapsedGroups?: string[];
  onToggleGroup?: (label: string) => void;
  onLocationChange: (value: string) => void;
  onDraftChange: (row: InventoryCountRow, value: string) => void;
  onMemoChange: (row: InventoryCountRow, value: string) => void;
  onClearDraft: (row: InventoryCountRow) => void;
  onSubmitCount: (row: InventoryCountRow, countedQuantity: string, memo: string) => void;
  onToggleSelection?: (id: string, checked: boolean) => void;
  onToggleVisibleSelection?: (ids: string[], checked: boolean) => void;
  onSubmitBulkCount?: (rows: InventoryCountRow[]) => void;
  loading?: boolean;
  readError?: boolean;
  emptyLabel?: string;
}) {
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visibleRows = rows;
  const displayRows = visibleRows;
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
  const groupedRows = useMemo(() => {
    const groups: Array<{ label: string; rows: InventoryCountRow[] }> = [];
    for (const row of displayRows) {
      const label = getTextbookGroupLabel(row.source);
      const current = groups[groups.length - 1];
      if (current?.label === label) {
        current.rows.push(row);
      } else {
        groups.push({ label, rows: [row] });
      }
    }
    return groups;
  }, [displayRows]);
  const noRowsLabel = loading ? "재고 목록을 불러오는 중…" : readError ? "재고 목록을 불러오지 못했습니다" : emptyLabel;

  const locationControl = <DataTableSelectFilter inline id="inventory-location-filter" label="위치" ariaLabel="실사 위치 선택"
    value={locationId} onValueChange={onLocationChange}
    options={locations.map((location) => ({ value: getRecordId(location), label: text(location.name || location.code) }))} />;

  return (
    <section className="min-w-0" aria-label="재고 실사 입력" aria-busy={loading} data-total-count={summary?.totalCount}>
      <DataTableWorkspaceToolbar feedback={readFeedback} search={searchControl}
        actions={
            <Button type="button" size="sm" className="col-span-2 sm:ml-1" disabled={schemaDisabled || saving === "count-inline-bulk" || selectedDraftRows.length === 0}
              aria-busy={saving === "count-inline-bulk"} aria-label="선택 재고 실사 일괄 반영" title="선택 재고 실사 일괄 반영"
              onClick={() => onSubmitBulkCount?.(selectedDisplayRows)}>
              선택 반영
            </Button>
        }
        filters={classificationControls ? classificationControls(locationControl) : <DataTableFilters aria-label="재고 실사 위치 필터">{locationControl}</DataTableFilters>}
      />
      <div className={DATA_TABLE_MOBILE_LIST_CLASS_NAME}>
        {displayRows.map((row) => {
          const draftKey = getInventoryCountDraftKey(row.id, row.locationId);
          return <InventoryCountMobileCard key={draftKey} row={row} value={countDrafts[draftKey] || ""} memoValue={memoDrafts[draftKey] || ""}
            selected={selectedIdSet.has(row.id)} onSelectionChange={(checked) => onToggleSelection?.(row.id, checked)}
            saving={saving === `count-inline-${draftKey}`} disabled={schemaDisabled}
            onChange={(value) => onDraftChange(row, value)} onMemoChange={(value) => onMemoChange(row, value)} onClear={() => onClearDraft(row)}
            onSubmit={(value, memo) => onSubmitCount(row, value, memo)} />;
        })}
        {visibleRows.length === 0 ? <div role="status" className="py-8 text-center text-sm text-muted-foreground">{noRowsLabel}</div> : null}
      </div>
      <DataTableViewport className={cn(TEXTBOOK_RESULTS_CLASS_NAME, "hidden md:block [&>[data-slot=table-container]]:overflow-visible")} role="region" tabIndex={0} aria-label="재고 실사 목록">
        <Table className="min-w-[1164px] table-fixed">
          <caption className="sr-only">재고 실사 입력 목록</caption>
          <TableHeader>
            <DataTableHeaderRow>
              <DataTableHeaderCell className="w-10 px-0"><DataTableSelectionCheckbox checked={allDisplayRowsSelected || (someDisplayRowsSelected && "indeterminate")}
                onCheckedChange={(value) => onToggleVisibleSelection?.(displayRowIds, value === true)} aria-label="표시된 재고 행 전체 선택" title="표시된 재고 행 전체 선택" /></DataTableHeaderCell>
              <DataTableHeaderCell className="w-[260px]">교재</DataTableHeaderCell>
              <DataTableHeaderCell className="w-[72px] text-right">현재</DataTableHeaderCell>
              <DataTableHeaderCell className="w-[180px]">실사</DataTableHeaderCell>
              <DataTableHeaderCell className="w-[72px] text-right">차이</DataTableHeaderCell>

              <DataTableHeaderCell className="w-[168px]">최종 실사</DataTableHeaderCell>
              <DataTableHeaderCell className="w-[184px]">메모</DataTableHeaderCell>
              <DataTableHeaderCell className={cn("w-[88px] text-right", stickyActionHeadClassName)}>작업</DataTableHeaderCell>
            </DataTableHeaderRow>
          </TableHeader>
          <TableBody>
            {groupedRows.map((group) => {
              const isCollapsed = collapsedGroups.includes(group.label);
              const GroupIcon = isCollapsed ? ChevronRight : ChevronDown;
              return <Fragment key={`${group.label}:${group.rows[0].id}`}>
                <DataTableBodyRow>
                  <DataTableBodyCell colSpan={8} className="bg-muted/40 p-0">
                    <Button type="button" variant="ghost" size="sm" className="h-9 w-full justify-start rounded-none px-3 text-xs font-semibold"
                      aria-expanded={!isCollapsed} aria-label={`${group.label} 그룹 ${isCollapsed ? "펼치기" : "접기"}`} onClick={() => onToggleGroup?.(group.label)}>
                      <GroupIcon className="size-3.5" aria-hidden="true" />{group.label} · {formatQuantity(group.rows.length)}종
                    </Button>
                  </DataTableBodyCell>
                </DataTableBodyRow>
                {isCollapsed ? null : group.rows.map((row) => {
                  const draftKey = getInventoryCountDraftKey(row.id, row.locationId);
                  const draftValue = countDrafts[draftKey] || "";
                  const memoValue = memoDrafts[draftKey] || "";
                  const isSaving = saving === `count-inline-${draftKey}`;
                  return <DataTableBodyRow key={draftKey} data-prepared-surface="inventory-desktop" data-prepared-row-id={row.id} data-state={selectedIdSet.has(row.id) ? "selected" : undefined}>
                    <DataTableBodyCell className="px-0 py-1"><DataTableSelectionCheckbox checked={selectedIdSet.has(row.id)} onCheckedChange={(value) => onToggleSelection?.(row.id, value === true)} title={`${row.title} ${row.locationName} 재고 선택`} aria-label={`${row.title} ${row.locationName} 재고 선택`} /></DataTableBodyCell>
                    <DataTableBodyCell wrap><div className="font-medium">{row.title}</div><div className="mt-1 text-xs text-muted-foreground">{compactUniqueLabels([row.publisher, row.locationName]).join(" · ")}</div></DataTableBodyCell>
                    <DataTableBodyCell className="text-right tabular-nums">{formatQuantity(row.currentQuantity)}</DataTableBodyCell>
                    <DataTableBodyCell><InventoryCountQuantityInput row={row} value={draftValue} memoValue={memoValue} saving={isSaving} disabled={schemaDisabled}
                      onChange={(value) => onDraftChange(row, value)} onClear={() => onClearDraft(row)} onSubmit={(value, memo) => onSubmitCount(row, value, memo)} /></DataTableBodyCell>
                    <DataTableBodyCell className="text-right"><InventoryCountDifference row={row} value={draftValue} /></DataTableBodyCell>

                    <DataTableBodyCell wrap className="text-xs text-muted-foreground">{getInventoryCountReasonLabel(row)}</DataTableBodyCell>
                    <DataTableBodyCell><Input value={memoValue} onChange={(event) => onMemoChange(row, event.target.value)} onBlur={(event) => onMemoChange(row, normalizeStoredTextInput(event.target.value))} aria-label={`${row.title} ${row.locationName} 실사 메모`} placeholder="메모" /></DataTableBodyCell>
                    <DataTableBodyCell className={cn("text-right group-hover/data-table-row:bg-muted group-data-[state=selected]/data-table-row:bg-accent", stickyActionCellClassName)}><InventoryCountSubmitButton row={row} value={draftValue} saving={isSaving} disabled={schemaDisabled} onSubmit={() => onSubmitCount(row, draftValue, memoValue)} /></DataTableBodyCell>
                  </DataTableBodyRow>;
                })}
              </Fragment>;
            })}
            {visibleRows.length === 0 ? <DataTableBodyRow><DataTableBodyCell colSpan={8} className="h-28 text-center text-muted-foreground"><span role="status">{noRowsLabel}</span></DataTableBodyCell></DataTableBodyRow> : null}
          </TableBody>
        </Table>
      </DataTableViewport>
    </section>
  );
}

type InventoryCountInputProps = {
  row: InventoryCountRow;
  value: string;
  memoValue: string;
  saving: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
  onSubmit: (value: string, memo: string) => void;
};

function InventoryCountQuantityInput({ row, value, memoValue, saving, disabled, onChange, onClear, onSubmit }: InventoryCountInputProps) {
  const hasDraftContent = Boolean(text(value) || text(memoValue));
  return <div className="flex min-w-0 items-center gap-1">
    <Input value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (!disabled && !saving && text(value)) onSubmit(value, memoValue);
      }
    }} inputMode="numeric" pattern="[0-9]*" autoComplete="off" enterKeyHint="done" aria-label={`${row.title} ${row.locationName} 실사 수량`}
      placeholder={`${formatQuantity(row.currentQuantity)}`} className="h-10 text-right tabular-nums md:h-9" />
    <Button type="button" variant="ghost" size="sm" className="h-10 px-2 md:h-9" title={hasDraftContent ? "실사 입력 초기화" : "현재 수량 입력"}
      aria-label={hasDraftContent ? `${row.title} ${row.locationName} 실사 입력 초기화` : `${row.title} ${row.locationName} 현재 수량 입력`}
      onClick={() => hasDraftContent ? onClear() : onChange(getInventoryCurrentQuantityDraft(row))}>
      {hasDraftContent ? "초기화" : "현재"}
    </Button>
  </div>;
}

function InventoryCountSubmitButton({ row, value, saving, disabled, onSubmit }: Pick<InventoryCountInputProps, "row" | "value" | "saving" | "disabled"> & { onSubmit: () => void }) {
  return <Button type="button" size="sm" variant={text(value) ? "default" : "outline"} className="h-10 md:h-8"
    title={getInventoryCountSubmitLabel({ row, draftValue: value, isSaving: saving, schemaDisabled: disabled })}
    aria-label={getInventoryCountSubmitLabel({ row, draftValue: value, isSaving: saving, schemaDisabled: disabled })}
    disabled={disabled || saving || !text(value)} aria-busy={saving} onClick={onSubmit}>{saving ? "반영 중…" : "반영"}</Button>;
}

function InventoryCountDifference({ row, value }: Pick<InventoryCountInputProps, "row" | "value">) {
  const difference = text(value) ? numberValue(value) - row.currentQuantity : 0;
  return <span className={cn("tabular-nums", difference < 0 && "text-destructive", difference > 0 && "text-primary")}>
    {text(value) ? `${difference > 0 ? "+" : ""}${formatQuantity(difference)}` : "—"}
  </span>;
}

function InventoryCountMobileCard({ row, value, memoValue, saving, disabled, selected, onSelectionChange, onChange, onMemoChange, onClear, onSubmit }: InventoryCountInputProps & {
  selected: boolean;
  onSelectionChange: (checked: boolean) => void;
  onMemoChange: (value: string) => void;
}) {
  return <form data-prepared-surface="inventory-mobile" data-prepared-row-id={row.id}
    className={DATA_TABLE_MOBILE_ITEM_CLASS_NAME} data-state={selected ? "selected" : undefined}
    onSubmit={(event) => { event.preventDefault(); if (!disabled && !saving && text(value)) onSubmit(value, memoValue); }}>
    <div className="flex items-start gap-2">
      <DataTableSelectionCheckbox checked={selected} onCheckedChange={(checked) => onSelectionChange(checked === true)} aria-label={`${row.title} ${row.locationName} 재고 선택`} />
      <div className="min-w-0 flex-1">
        <div className="whitespace-normal break-words text-sm font-medium">{row.title}</div>
        <div className="mt-1 break-words text-xs text-muted-foreground">{compactUniqueLabels([row.publisher, row.locationName]).join(" · ")}</div>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-y border-border/60 py-2 text-xs">
      <span className="tabular-nums">현재 {formatQuantity(row.currentQuantity)}권 · 차이 <InventoryCountDifference row={row} value={value} /></span>

    </div>
    <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
      <div className="grid min-w-0 gap-1"><span className="text-xs text-muted-foreground">실사 수량</span>
        <InventoryCountQuantityInput row={row} value={value} memoValue={memoValue} saving={saving} disabled={disabled} onChange={onChange} onClear={onClear} onSubmit={onSubmit} />
      </div>
      <InventoryCountSubmitButton row={row} value={value} saving={saving} disabled={disabled} onSubmit={() => onSubmit(value, memoValue)} />
    </div>
    <Input value={memoValue} onChange={(event) => onMemoChange(event.target.value)} onBlur={(event) => onMemoChange(normalizeStoredTextInput(event.target.value))}
      aria-label={`${row.title} ${row.locationName} 실사 메모`} placeholder="메모" className="mt-2 h-10" />
    <p className="mt-2 break-words text-xs text-muted-foreground">{getInventoryCountReasonLabel(row)}</p>
  </form>;
}

function TextbookTable({
  rows,
  locations,
  summary,
  onSelectTextbook,
  amountMode = "stockValue",
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
  rows: import("./textbook-read-types").TextbookMasterRow[];
  locations: Row[];
  summary?: TextbookMasterSummary | null;
  onSelectTextbook?: (row: Row) => void;
  amountMode?: TextbookAmountMode;
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
  const columnSpan = locationColumns.length + 2 + 2 + (onSelectTextbook ? 1 : 0) + (hasSelection ? 1 : 0);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const sortedGroupedRows = useMemo(() => {
    const groups: Array<{ label: string; rows: Row[] }> = [];
    for (const row of rows) {
      const label = getTextbookGroupLabel(row);
      const current = groups[groups.length - 1];
      if (current?.label === label) {
        current.rows.push(row);
      } else {
        groups.push({ label, rows: [row] });
      }
    }
    return groups;
  }, [rows]);
  const tableTotals = summary ? {
    totalQuantity: summary.totalQuantity,
    amountValue: amountMode === "salePrice" ? summary.salePriceTotal : summary.stockValue,
    locationQuantities: summary.locationQuantities,
  } : null;

  return (
    <div className="min-w-0" aria-label="교재 재고">
      <div data-testid="textbook-master-mobile-list" className={DATA_TABLE_MOBILE_LIST_CLASS_NAME}>
        {sortedGroupedRows.map((group) => {
          const isCollapsed = collapsedGroups.includes(group.label);
          const GroupIcon = isCollapsed ? ChevronRight : ChevronDown;
          const groupTotalQuantity = group.rows.reduce((sum, row) => sum + numberValue(row.totalQuantity), 0);

          return (
            <section key={`mobile-${getRecordId(group.rows[0])}`} className="min-w-0">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 w-full justify-start rounded-md px-2 text-left"
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
                <div className="grid min-w-0 gap-2">
                  {group.rows.map((row) => {
                    const rowId = getRecordId(row);
                    const rowA11yLabel = getTextbookIdentityLabel(row);
                    const totalQuantity = numberValue(row.totalQuantity);
                    const teacherQuantity = numberValue(row.teacherQuantity);
                    const publisherLabel = getKnownPublisherLabel(row);
                    const locationQuantities = (row.locationQuantities || {}) as Record<string, unknown>;
                    const amountValue = amountMode === "salePrice" ? getTextbookSalePrice(row) : row.stockValue;
                    const schoolLevelLabel = getTextbookSchoolLevelSummary(row) || "-";
                    const gradeLabel = getTextbookGradeSummary(row) || "-";
                    const subSubjectLabel = getTextbookSubSubject(row) || "-";
                    const categorySummary = compactUniqueLabels([getSubjectLabel(row.subject), schoolLevelLabel, gradeLabel, subSubjectLabel]).join(" · ") || "-";
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
                        data-prepared-surface="master-mobile"
                        data-prepared-row-id={rowId}
                        className={cn(
                          DATA_TABLE_MOBILE_ITEM_CLASS_NAME,
                          selectedIdSet.has(rowId) && "border-primary/40 bg-accent",
                          row.status === "inactive" && "bg-muted/20 text-muted-foreground",
                        )}
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          {hasSelection ? (
                            <DataTableSelectionCheckbox
                              checked={selectedIdSet.has(rowId)}
                              onCheckedChange={(value) => onBulkSelectionChange?.(rowId, !!value)}
                              title={`${rowA11yLabel} 선택`}
                              aria-label={`${rowA11yLabel} 선택`}
                              className="-ml-2 -mt-1"
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
                                    className="block max-w-full whitespace-normal break-words text-left text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                    onClick={() => onSelectTextbook(row)}
                                  >
                                    {getTextbookTitle(row)}
                                  </button>
                                ) : (
                                  <p className="break-words text-sm font-semibold">{getTextbookTitle(row)}</p>
                                )}
                                {publisherLabel ? <p className="break-words text-xs text-muted-foreground">{publisherLabel}</p> : null}
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
                              <span className="break-words text-xs leading-5 text-muted-foreground">{categorySummary}</span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="py-1">
                                <p className="text-muted-foreground">합계</p>
                                <p className={cn("font-semibold tabular-nums", inventoryQuantityTone(totalQuantity))}>
                                  {formatQuantity(totalQuantity)}
                                </p>
                                {teacherQuantity > 0 ? (
                                  <p className="text-[11px] text-muted-foreground">교사용 {formatQuantity(teacherQuantity)}</p>
                                ) : null}
                              </div>
                              <div className="py-1 text-right">
                                <p className="text-muted-foreground">{amountHeader}</p>
                                <p className="font-semibold tabular-nums">{formatCurrency(amountValue)}</p>
                              </div>
                            </div>

                            {locationSummary.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                                {locationSummary.map((location) => (
                                  <span key={`${rowId}-${location.label}`} className="tabular-nums">
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

      <DataTableViewport className={cn(TEXTBOOK_RESULTS_CLASS_NAME, "hidden md:block [&>[data-slot=table-container]]:overflow-visible")} role="region" aria-label="교재 재고 스크롤" tabIndex={0}>
      <Table className="min-w-[760px] table-fixed" style={{ minWidth: 720 + locationColumns.length * 80 }}>
        <caption className="sr-only">교재 재고</caption>
        <colgroup>{hasSelection ? <col style={{ width: 40 }} /> : null}<col /><col style={{ width: 144 }} />
          {locationColumns.map(location => <col key={location.id} style={{ width: 80 }} />)}
          <col style={{ width: 80 }} /><col style={{ width: 112 }} />{onSelectTextbook ? <col style={{ width: 48 }} /> : null}
        </colgroup>
        <TableHeader>
          <DataTableHeaderRow>
            {hasSelection ? (
              <DataTableHeaderCell className="z-10 w-10 px-0">
                <DataTableSelectionCheckbox
                  checked={allVisibleSelected || (someVisibleSelected && "indeterminate")}
                  onCheckedChange={(value) => onToggleAllVisible?.(!!value)}
                  title="현재 교재 전체 선택"
                  aria-label="현재 교재 전체 선택"
                />
              </DataTableHeaderCell>
            ) : null}
            <DataTableHeaderCell className="z-10 min-w-72">교재</DataTableHeaderCell>
            <DataTableHeaderCell className="z-10 w-36">분류</DataTableHeaderCell>
            {locationColumns.map((location) => (
              <DataTableHeaderCell key={location.id} className="z-10 w-20 text-right">{location.label}</DataTableHeaderCell>
            ))}
            <DataTableHeaderCell className="z-10 w-20 text-right">합계</DataTableHeaderCell>
            <DataTableHeaderCell className="z-10 w-28 text-right">{amountHeader}</DataTableHeaderCell>
            {onSelectTextbook ? <DataTableHeaderCell className={cn("z-20 w-12 text-right", stickyActionHeadClassName)}>관리</DataTableHeaderCell> : null}
          </DataTableHeaderRow>
        </TableHeader>
        <TableBody>
          {sortedGroupedRows.map((group) => (
            <Fragment key={getRecordId(group.rows[0])}>
              {(() => {
                const isCollapsed = collapsedGroups.includes(group.label);
                const GroupIcon = isCollapsed ? ChevronRight : ChevronDown;
                const groupTotalQuantity = group.rows.reduce((sum, row) => sum + numberValue(row.totalQuantity), 0);
                const groupCountLabel = `${formatQuantity(group.rows.length)}종`;
                const groupDetailText = [
                  `${formatQuantity(group.rows.length)}종`,
                  `재고 ${formatQuantity(groupTotalQuantity)}권`,
                ].filter(Boolean).join(" · ");

                return (
                  <>
                    <DataTableBodyRow>
                      <DataTableBodyCell colSpan={columnSpan} className="bg-muted/40 p-0 text-xs font-semibold text-muted-foreground">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 w-full justify-start rounded-none px-3 text-xs font-semibold"
                          aria-expanded={!isCollapsed}
                          aria-label={`${group.label} 그룹 ${isCollapsed ? "펼치기" : "접기"} · ${groupDetailText}`}
                          title={groupDetailText}
                          onClick={() => onToggleGroup?.(group.label)}
                        >
                          <GroupIcon className="mr-2 size-3.5" />
                          <span>{group.label}</span>
                          <span className="ml-auto flex min-w-0 items-center gap-1.5">
                            <span className="tabular-nums text-muted-foreground">{groupCountLabel}</span>
                          </span>
                        </Button>
                      </DataTableBodyCell>
                    </DataTableBodyRow>
                    {isCollapsed ? null : group.rows.map((row) => {
                const rowId = getRecordId(row);
                const rowA11yLabel = getTextbookIdentityLabel(row);
                const totalQuantity = numberValue(row.totalQuantity);
                const teacherQuantity = numberValue(row.teacherQuantity);
                const publisherLabel = getKnownPublisherLabel(row);
                const locationQuantities = (row.locationQuantities || {}) as Record<string, unknown>;
                const amountValue = amountMode === "salePrice" ? getTextbookSalePrice(row) : row.stockValue;
                const gradeLabel = getTextbookGradeSummary(row) || "-";
                const schoolLevelLabel = getTextbookSchoolLevelSummary(row) || "-";
                const subSubjectLabel = getTextbookSubSubject(row) || "-";
                return (
                  <DataTableBodyRow data-testid={`textbook-master-desktop-row-${rowId}`} data-prepared-surface="master-desktop" data-prepared-row-id={rowId} data-state={selectedIdSet.has(rowId) ? "selected" : undefined} key={rowId} className={cn(row.status === "inactive" && "bg-muted/20 text-muted-foreground")}>
                    {hasSelection ? (
                      <DataTableBodyCell className="w-10 px-0 py-1">
                        <DataTableSelectionCheckbox
                          checked={selectedIdSet.has(rowId)}
                          onCheckedChange={(value) => onBulkSelectionChange?.(rowId, !!value)}
                          title={`${rowA11yLabel} 선택`}
                          aria-label={`${rowA11yLabel} 선택`}
                        />
                      </DataTableBodyCell>
                    ) : null}
                    <DataTableBodyCell wrap className="min-w-0 py-2">
                      {onSelectTextbook ? (
                        <button
                          type="button"
                          aria-label={`${rowA11yLabel} 열기`}
                          title={rowA11yLabel}
                          className="block max-w-full whitespace-normal break-words text-left font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                    </DataTableBodyCell>
                    <DataTableBodyCell wrap className="text-xs leading-5">
                      <div>{schoolLevelLabel} · {gradeLabel}</div>
                      <div className="text-muted-foreground">{subSubjectLabel}</div>
                    </DataTableBodyCell>
                    {locationColumns.map((location) => (
                      <DataTableBodyCell key={location.id} className="text-right tabular-nums">
                        {formatQuantity(locationQuantities[location.id])}
                      </DataTableBodyCell>
                    ))}
                    <DataTableBodyCell className={cn("text-right font-medium tabular-nums", inventoryQuantityTone(totalQuantity))}>
                      {formatQuantity(totalQuantity)}
                      {teacherQuantity > 0 ? (
                        <div className="text-[11px] font-normal text-muted-foreground">교사용 {formatQuantity(teacherQuantity)}</div>
                      ) : null}
                    </DataTableBodyCell>
                    <DataTableBodyCell className="text-right tabular-nums">{formatCurrency(amountValue)}</DataTableBodyCell>
                    {onSelectTextbook ? (
                      <DataTableBodyCell className={cn("text-right group-hover/data-table-row:bg-muted group-data-[state=selected]/data-table-row:bg-accent", stickyActionCellClassName)}>
                        <Button type="button" variant="ghost" size="icon" className="size-8 rounded-md" aria-label={`${rowA11yLabel} 편집`} title={`${getTextbookTitle(row)} 편집`} onClick={() => onSelectTextbook(row)}>
                          <Pencil className="size-3.5" />
                        </Button>
                      </DataTableBodyCell>
                    ) : null}
                  </DataTableBodyRow>
                );
                    })}
                  </>
                );
              })()}
            </Fragment>
          ))}
	          {rows.length > 0 ? (
	            <DataTableBodyRow className="bg-muted/30 text-xs font-semibold text-muted-foreground">
	              {hasSelection ? <DataTableBodyCell /> : null}
	              <DataTableBodyCell>{tableTotals ? "합계" : "집계 확인 필요"}</DataTableBodyCell>
	              <DataTableBodyCell />
	              {locationColumns.map((location) => (
                <DataTableBodyCell key={location.id} className="text-right tabular-nums">
                  {tableTotals ? formatQuantity(tableTotals.locationQuantities[location.id]) : "—"}
                </DataTableBodyCell>
              ))}
              <DataTableBodyCell className="text-right tabular-nums">{tableTotals ? formatQuantity(tableTotals.totalQuantity) : "—"}</DataTableBodyCell>
              <DataTableBodyCell className="text-right tabular-nums">{tableTotals ? formatCurrency(tableTotals.amountValue) : "—"}</DataTableBodyCell>
              {onSelectTextbook ? <DataTableBodyCell /> : null}
            </DataTableBodyRow>
          ) : null}
          {rows.length === 0 ? (
            <DataTableBodyRow>
              <DataTableBodyCell colSpan={columnSpan} className="h-28 text-center text-muted-foreground">
                <div className="flex flex-col items-center justify-center gap-2">
                  <span>{emptyLabel}</span>
                  {emptyActionLabel && onEmptyAction ? (
                    <Button type="button" variant="outline" size="sm" className="h-8 rounded-md" onClick={onEmptyAction}>
                      {emptyActionLabel}
                    </Button>
                  ) : null}
                </div>
              </DataTableBodyCell>
            </DataTableBodyRow>
          ) : null}
        </TableBody>
      </Table>
      </DataTableViewport>
    </div>
  );
}

function InventoryHistoryPanel({
  readFeedback,
  rows: transportRows,
  loading = false,
  readError = false,
  currentUserId,
  currentUserLabel,
  canDeleteHistory,
  saving,
  onDeleteHistory,
}: {
  readFeedback?: React.ReactNode;
  rows: TextbookInventoryHistoryTransport[];
  loading?: boolean;
  readError?: boolean;
  currentUserId: string;
  currentUserLabel: string;
  canDeleteHistory: boolean;
  saving: string;
  onDeleteHistory: (row: InventoryHistoryRow) => void;
}) {
  const rows = useMemo(() => transportRows.map((row) => ({
    ...row,
    actor: row.actorLabel || (row.actorId === currentUserId ? currentUserLabel : row.actorId) || "-",
  })), [currentUserId, currentUserLabel, transportRows]);
  const emptyLabel = loading ? "재고 이력을 불러오는 중…" : readError ? "재고 이력을 불러오지 못했습니다" : "재고 이력이 없습니다";

  return (
    <section className="min-w-0" aria-label="재고 이력" aria-busy={loading}>
      <DataTableToolbar>
        <div className="flex min-h-9 items-center justify-between gap-2"><h3 className="text-sm font-semibold">재고 이력</h3>{readFeedback}</div>
      </DataTableToolbar>
      <div className={DATA_TABLE_MOBILE_LIST_CLASS_NAME}>
        {rows.map((row) => (
          <div key={row.id} data-prepared-surface="inventory-history-mobile" data-prepared-row-id={row.id} className="grid min-w-0 gap-2 rounded-md border bg-background p-3">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="whitespace-normal break-words text-sm font-medium">{row.textbookTitle}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{formatCompactDateTime(row.at)} · {row.locationName}</div>
              </div>
              <Badge variant="outline" className="shrink-0 rounded-md tabular-nums">{row.change}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div className="min-w-0 whitespace-normal break-words">{row.action}</div>
              <div className="min-w-0 whitespace-normal break-words text-right">{row.actor}</div>
            </div>
            {row.memo ? <div className="whitespace-normal break-words text-xs text-muted-foreground">{row.memo}</div> : null}
            {canDeleteHistory ? (
              <Button
                type="button"
                variant="destructive-outline"
                size="sm"
                className="h-8 w-full"
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
          <div role="status" className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</div>
        ) : null}
      </div>
      <DataTableViewport className="hidden max-h-[480px] md:block [&>[data-slot=table-container]]:overflow-visible" role="region" tabIndex={0} aria-label="재고 이력 스크롤">
        <Table className="min-w-[1120px] table-fixed">
          <caption className="sr-only">재고 이력 목록</caption>
          <TableHeader>
            <DataTableHeaderRow>
              <DataTableHeaderCell className="w-[120px]">일시</DataTableHeaderCell>
              <DataTableHeaderCell className="w-[260px]">교재</DataTableHeaderCell>
              <DataTableHeaderCell className="w-[96px]">위치</DataTableHeaderCell>
              <DataTableHeaderCell className="w-[88px] text-right">변경</DataTableHeaderCell>
              <DataTableHeaderCell className="w-[140px]">작업</DataTableHeaderCell>
              <DataTableHeaderCell className="w-[160px]">실행자</DataTableHeaderCell>
              <DataTableHeaderCell className="w-[220px]">메모</DataTableHeaderCell>
              {canDeleteHistory ? <DataTableHeaderCell className="w-[72px] text-right">삭제</DataTableHeaderCell> : null}
            </DataTableHeaderRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <DataTableBodyRow key={row.id} data-prepared-surface="inventory-history-desktop" data-prepared-row-id={row.id}>
                <DataTableBodyCell wrap className="text-muted-foreground">{formatCompactDateTime(row.at)}</DataTableBodyCell>
                <DataTableBodyCell wrap className="max-w-[320px] whitespace-normal break-words font-medium">{row.textbookTitle}</DataTableBodyCell>
                <DataTableBodyCell wrap className="whitespace-normal break-words">{row.locationName}</DataTableBodyCell>
                <DataTableBodyCell wrap className="text-right font-medium">{row.change}</DataTableBodyCell>
                <DataTableBodyCell wrap>{row.action}</DataTableBodyCell>
                <DataTableBodyCell wrap className="max-w-[160px] whitespace-normal break-words">{row.actor}</DataTableBodyCell>
                <DataTableBodyCell wrap className="max-w-[220px] whitespace-normal break-words text-muted-foreground">{row.memo || "-"}</DataTableBodyCell>
                {canDeleteHistory ? (
                  <DataTableBodyCell wrap className="text-right">
                    <Button
                      type="button"
                      variant="destructive-ghost"
                      size="icon"
                      className="size-8"
                      disabled={saving === `inventory-history-delete-${row.id}`}
                      aria-label={`${row.textbookTitle} 재고 이력 삭제`}
                      title="재고 이력 삭제"
                      onClick={() => onDeleteHistory(row)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </DataTableBodyCell>
                ) : null}
              </DataTableBodyRow>
            ))}
            {rows.length === 0 ? (
              <DataTableBodyRow>
                <DataTableBodyCell wrap colSpan={canDeleteHistory ? 8 : 7} className="h-20 text-center text-muted-foreground">
                  <span role="status">{emptyLabel}</span>
                </DataTableBodyCell>
              </DataTableBodyRow>
            ) : null}
          </TableBody>
        </Table>
      </DataTableViewport>
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
  return "입고 완료 건은 교재 재고에서 확인할 수 있습니다.";
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
    return "출고 처리된 교재는 재고 이력에서 확인할 수 있습니다.";
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
  searchControl,
  readFeedback,
  mode,
  preparedRows,
  summary,
  acceptedFilters,
  loading = false,
  readError = false,
  canManageRequestLines = true,
  orders,
  lines,
  textbooks,
  publishers,
  locations,
  suppliers,
  publisherSupplierLinks,
  classes,
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
  searchControl?: React.ReactNode;
  readFeedback?: React.ReactNode;
  mode: "request" | "order";
  preparedRows: TextbookPurchaseCaseRow[];
  summary: TextbookPurchaseSummary | null;
  acceptedFilters: PurchaseFilters | null;
  loading?: boolean;
  readError?: boolean;
  canManageRequestLines?: boolean;
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
  const [purchaseHandoffGroups, setPurchaseHandoffGroups] = useState<TextbookHandoffGroup[]>([]);
  const [returnHandoffGroups, setReturnHandoffGroups] = useState<TextbookHandoffGroup[]>([]);
  const [purchaseHandoffSourceLineCount, setPurchaseHandoffSourceLineCount] = useState(0);
  const [returnHandoffSourceLineCount, setReturnHandoffSourceLineCount] = useState(0);
  const [purchaseHandoffState, setPurchaseHandoffState] = useState("");
  const [returnHandoffState, setReturnHandoffState] = useState("");
  const handoffAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => handoffAbortRef.current?.abort(), []);
  const grouped = useMemo(() => groupPurchaseLinesByStatus({ orders, lines }) as Record<string, Row[]>, [lines, orders]);
  const ordersById = useMemo(() => new Map(orders.map((order) => [getRecordId(order), order])), [orders]);
  const requestFilterOptions = useMemo(
    () => [
    { value: "all", label: "전체 교재" },
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
  const displayedFilter = acceptedFilters?.orderFilter ?? orderFilter;
  const visibleGroups = useMemo(() => {
    if (mode === "request") {
      return groups;
    }
    if (displayedFilter === "waiting") {
      return groups.filter((group) => group.id === "requested" || group.id === "ordered" || group.id === "partially_received");
    }
    if (displayedFilter === "partial") {
      return groups.filter((group) => group.id === "partially_received");
    }
    if (displayedFilter === "returnable") {
      return groups.filter((group) => group.id === "partially_received" || group.id === "received");
    }
    if (displayedFilter === "returned") {
      return groups.filter((group) => group.id === "returned");
    }
    return groups;
  }, [groups, mode, displayedFilter]);
  const showBulkPurchaseSelection = mode === "order" && Boolean(onToggleLine && onToggleVisibleLines);
  const selectedLineIdSet = useMemo(() => new Set(selectedLineIds), [selectedLineIds]);

  function toggleGroup(id: string) {
    setCollapsedGroups((current) => ({ ...current, [id]: !current[id] }));
  }

  const searchMatchedPurchaseRowsByGroup = useMemo(() => {
    const rowsByGroup = new Map<string, Row[]>();
    for (const group of groups) {
      rowsByGroup.set(group.id, grouped[group.id] || []);
    }
    return rowsByGroup;
  }, [grouped, groups]);

  const getVisiblePurchaseRows = useCallback((groupId: string) => {
    return searchMatchedPurchaseRowsByGroup.get(groupId) || [];
  }, [searchMatchedPurchaseRowsByGroup]);

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

  const hasVisiblePurchaseRows = visiblePurchaseRows.length > 0;
  const renderedGroups = visibleGroups.filter((group) => getCurrentVisiblePurchaseRows(group.id).length > 0);
  const emptyGroupId = visibleGroups[0]?.id || (mode === "request" ? "requested" : "ordered");
  const purchaseProcessFilterCounts = summary ? {
    request: summary.requestCounts,
    order: summary.orderCounts,
    boardScope: summary.boardScopeCounts,
  } : null;
  const purchaseProcessActionIds = useMemo(() => {
    const orderable: string[] = [];
    const receivable: string[] = [];
    const returnable: string[] = [];
    if (mode !== "order") {
      return { orderable, receivable, returnable };
    }

    // A displayed row can contain both student and teacher copies; select its actual members.
    for (const line of visiblePurchaseRows.flatMap(getPurchaseScopeLines)) {
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
  const purchaseBatchBusy = saving.startsWith("purchase-bulk-");
  const hasProcessSearchQuery = Boolean(text(searchQuery));
  const totalProcessRowCount = summary?.totalCount ?? null;
  const hasHiddenProcessRows =
    mode === "order" && Boolean(totalProcessRowCount && totalProcessRowCount > 0) && !hasVisiblePurchaseRows && !hasProcessSearchQuery;
  const purchaseFiltersAreDefault = boardScope === "active" && orderFilter === "all" && requestFilter === "all";
  const filtersChanging = Boolean(acceptedFilters && (acceptedFilters.boardScope !== boardScope || acceptedFilters.orderFilter !== orderFilter || acceptedFilters.requestFilter !== requestFilter || acceptedFilters.search !== searchQuery));
  const openPurchaseHandoff = useCallback((kind: "order" | "return") => {
    if (kind === "order") setHandoffDialogOpen(true); else setReturnHandoffDialogOpen(true);
    const setGroups = kind === "order" ? setPurchaseHandoffGroups : setReturnHandoffGroups;
    const setSourceLineCount = kind === "order" ? setPurchaseHandoffSourceLineCount : setReturnHandoffSourceLineCount;
    const setState = kind === "order" ? setPurchaseHandoffState : setReturnHandoffState;
    setGroups([]);
    setSourceLineCount(0);
    if (!acceptedFilters || mode !== "order") { setState("현재 필터가 아직 준비되지 않았습니다."); return; }
    const frozenFilters = { ...acceptedFilters };
    handoffAbortRef.current?.abort();
    const abort = new AbortController();
    handoffAbortRef.current = abort;
    setState("전체 필터 범위를 불러오는 중");
    void getTextbookPurchaseHandoff(frozenFilters, kind, { signal: abort.signal }).then((result) => {
      if (abort.signal.aborted) return;
      setGroups(result.groups);
      setSourceLineCount(result.sourceLineCount);
      setState(result.groups.length ? "전체 필터 범위 준비 완료" : "전체 필터 범위에 전달할 항목이 없습니다.");
    }, (error) => { if (!abort.signal.aborted) setState(getTextbookActionErrorMessage(error)); });
  }, [acceptedFilters, mode]);
  const emptyActionLabel = hasProcessSearchQuery
    ? "검색 초기화"
    : hasHiddenProcessRows
      ? "전체 보기"
      : undefined;
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

  function renderRowActions(line: Row, order: Row, displayLines: Row[], textbookTitle: string, status: PurchaseKanbanStatus, textbook: Row | undefined) {
    const lineId = getRecordId(line);
    const received = getPurchaseDisplayQuantity(displayLines, "received");
    const nextStatus = purchaseNextStatus(status);
    const processAction = purchaseProcessAction(status);
    const isMissingTextbookRequest = status === "requested" && !textbook;
    const isReturnablePurchaseLine = mode === "order" && received > 0 && status !== "returned" && status !== "cancelled";
    const isCancelablePurchaseLine = mode === "request" || (status !== "returned" && status !== "cancelled" && !isReturnablePurchaseLine);
    const busy = [`purchase-move-${lineId}`, `purchase-return-${lineId}`, `purchase-delete-${lineId}`].includes(saving);
    if (!canManageRequestLines) return null;
    return (
      <DataTableRowActions label={`${textbookTitle} ${mode === "request" ? "요청" : "주문·입고"} 더보기`} disabled={busy} primaryAction={
        mode === "request" ? (
          <Button type="button" variant="outline" size="sm" aria-label={`${textbookTitle} 요청 수정`} onClick={() => onSelectLine(line, order)}>수정</Button>
        ) : isMissingTextbookRequest ? (
          <Button type="button" variant="outline" size="sm" aria-label={`${textbookTitle} 마스터 등록`} onClick={() => onRegisterTextbook(line, order)}>교재 등록</Button>
        ) : nextStatus ? (
          <Button type="button" variant="outline" size="sm" aria-label={`${textbookTitle} ${processAction?.label || "이동"}`} disabled={busy} onClick={() => {
            if (processAction) { onSelectLine(line, order, processAction.stage); return; }
            onMoveLine(line, order, nextStatus as PurchaseKanbanStatus);
          }}>{processAction?.label || "이동"}</Button>
        ) : null}>
            <DropdownMenuItem aria-label={`${textbookTitle} ${mode === "request" ? "요청" : "주문·입고"} 수정`} onSelect={() => onSelectLine(line, order)}><Pencil />수정</DropdownMenuItem>
            {isReturnablePurchaseLine && onReturnLine ? <DropdownMenuItem aria-label={`${textbookTitle} 공급처 반품`} onSelect={() => onReturnLine(line, order)}><Truck />공급처 반품</DropdownMenuItem> : null}
            {mode === "order" && isMissingTextbookRequest && textbookTitle !== "-" ? (
              <DropdownMenuItem asChild><a href={buildKyoboSearchUrl(textbookTitle)} target="_blank" rel="noreferrer" aria-label={`${textbookTitle} 교보문고 검색`}><Search />교보문고 검색</a></DropdownMenuItem>
            ) : null}
            {isCancelablePurchaseLine ? <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" aria-label={`${textbookTitle} ${mode === "request" ? "요청" : "주문·입고"} 건 삭제`} onSelect={() => onDeleteLine({ ...line, purchaseScopeLines: displayLines }, order)}><Trash2 />삭제</DropdownMenuItem></> : null}
      </DataTableRowActions>
    );
  }

  return (
    <>
      {mode === "order" ? (
        <>
          <TextbookHandoffDialog
            open={handoffDialogOpen}
            onOpenChange={setHandoffDialogOpen}
            title="공급처 주문 전달"
            description="현재 필터의 전체 주문 건을 공급처별 이미지, PDF로 정리합니다."
            groups={purchaseHandoffGroups}
            sourceLineCount={purchaseHandoffSourceLineCount}
            loadState={purchaseHandoffState}
            onRetry={() => openPurchaseHandoff("order")}
            emptyLabel="전달할 주문 건이 없습니다"
            idPrefix="purchase-handoff"
            format="purchase-order"
          />
          <TextbookHandoffDialog
            open={returnHandoffDialogOpen}
            onOpenChange={setReturnHandoffDialogOpen}
            title="공급처 반품 요청서"
            description="현재 필터의 전체 반품 가능 건을 공급처별 이미지, PDF로 정리합니다."
            groups={returnHandoffGroups}
            sourceLineCount={returnHandoffSourceLineCount}
            loadState={returnHandoffState}
            onRetry={() => openPurchaseHandoff("return")}
            emptyLabel="반품 요청할 입고 건이 없습니다"
            idPrefix="purchase-return-handoff"
            format="purchase-return"
          />
        </>
      ) : null}
      <div
        className="min-w-0"
        aria-label={mode === "request" ? "교재 요청 목록" : "교재 주문·입고 목록"}
      >
      <DataTableWorkspaceToolbar feedback={readFeedback} search={searchControl}
        filters={mode === "order" ? (          <DataTableFilters aria-label="주문·입고 필터">
            <DataTableSelectFilter inline id="purchase-scope-filter" label="범위" ariaLabel="주문·입고 범위" value={boardScope} onValueChange={onScopeChange}
              options={(Object.keys(purchaseBoardScopeLabels) as PurchaseBoardScope[]).map((value) => ({ value, label: purchaseBoardScopeLabels[value], count: purchaseProcessFilterCounts?.boardScope[value] ?? null }))} />
            <DataTableSelectFilter inline id="purchase-stage-filter" label="단계" ariaLabel="주문·입고 단계" value={orderFilter} onValueChange={onOrderFilterChange}
              options={(Object.keys(purchaseOrderFilterLabels) as PurchaseOrderFilter[]).map((value) => ({ value, label: purchaseOrderFilterLabels[value], count: purchaseProcessFilterCounts?.order[value] ?? null }))} />
            <DataTableSelectFilter inline id="purchase-registration-filter" label="교재 등록" ariaLabel="주문·입고 교재 등록" value={requestFilter} onValueChange={onRequestFilterChange}
              options={requestFilterOptions.map((option) => ({ ...option, count: purchaseProcessFilterCounts?.request[option.value] ?? null }))} />
            <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 sm:size-9" disabled={purchaseFiltersAreDefault} aria-label="주문·입고 필터 초기화" onClick={() => {
              onScopeChange("active"); onOrderFilterChange("all"); onRequestFilterChange("all");
            }}><RefreshCw className="size-4" aria-hidden="true" /></Button>
          </DataTableFilters>) : (
          <DataTableFilters aria-label="교재 요청 필터">
            <DataTableSelectFilter inline id="request-registration-filter" label="교재 등록" ariaLabel="요청 교재 등록"
              value={requestFilter} onValueChange={onRequestFilterChange} options={requestFilterOptions} />
            <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 sm:size-9" disabled={requestFilter === "all"} aria-label="교재 요청 필터 초기화" onClick={() => onRequestFilterChange("all")}><RefreshCw className="size-4" aria-hidden="true" /></Button>
          </DataTableFilters>
        )}
        actions={<>
          <span role="status" className="sr-only">{purchaseBatchBusy ? "선택한 교재 처리 중…" : loading ? "목록 불러오는 중…" : filtersChanging ? "이전 조건의 결과 표시 중" : ""}</span>
          {mode === "order" && selectedProcessLineCount > 0 ? (<>
            <span className="mr-auto whitespace-nowrap text-sm font-medium tabular-nums">{formatQuantity(selectedProcessLineCount)}개 선택</span>
            {selectedOrderableRequestCount > 0 ? <Button type="button" size="sm" variant="outline" aria-label="선택 요청 일괄 주문" disabled={purchaseBatchBusy} onClick={onBulkOrder}>선택 주문</Button> : null}
            {selectedReceivableCount > 0 ? <Button type="button" size="sm" variant="outline" aria-label="선택 주문 일괄 입고" disabled={purchaseBatchBusy} aria-busy={saving === "purchase-bulk-receive"} onClick={onBulkReceive}>선택 입고</Button> : null}
            {selectedReturnableCount > 0 ? <DataTableRowActions label="선택 주문·입고 작업" disabled={purchaseBatchBusy}><DropdownMenuItem aria-label="선택 입고 건 공급처 반품" onSelect={onBulkReturn}>선택 반품</DropdownMenuItem></DataTableRowActions> : null}
            <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 sm:size-9" aria-label="주문·입고 선택 해제" disabled={purchaseBatchBusy} onClick={() => onToggleVisibleLines?.(selectedLineIds, false)}><X className="size-4" /></Button>
          </>) : (<>{mode === "request" ? (
              <Button type="button" size="sm" className="shrink-0" aria-label="교재 요청 추가" title="교재 요청 추가" onClick={onAddLine}>
                <Plus className="mr-2 size-4" />
                요청 추가
              </Button>
            ) : (
              <>
                {acceptedFilters ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" size="sm" aria-label="주문 문서 메뉴" disabled={loading || filtersChanging || !hasVisiblePurchaseRows} className="gap-1.5">
                        <Copy className="size-3.5" aria-hidden="true" />주문서<ChevronDown className="size-3.5" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-48 motion-reduce:animate-none">
                      <DropdownMenuItem aria-label="공급처별 주문 전달 열기" onSelect={() => openPurchaseHandoff("order")}><Copy />공급처별 주문서</DropdownMenuItem>
                      <DropdownMenuItem aria-label="공급처 반품 요청서 열기" onSelect={() => openPurchaseHandoff("return")}><Truck />반품 요청서</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                <Button type="button" size="sm" className="shrink-0" aria-label="교재 주문 추가" title="교재 주문 추가" onClick={onAddLine}>
                  <Plus className="mr-2 size-4" />
                  주문 추가
                </Button>
              </>
            )}</>)}
        </>}
      />

      <div data-slot="data-table-results" className={TEXTBOOK_RESULTS_CLASS_NAME}>
      {!hasVisiblePurchaseRows ? (
        <ProcessGroupEmptyState
          label={loading ? "목록 불러오는 중…" : readError ? "교재 목록을 불러오지 못했습니다" : getPurchaseProcessEmptyLabel(mode, emptyGroupId, requestFilter, orderFilter, searchQuery)}
          hint={!readError && !hasHiddenProcessRows ? getPurchaseProcessEmptyHint(mode, emptyGroupId, requestFilter, orderFilter, searchQuery) : undefined}
          actionLabel={loading || readError ? undefined : emptyActionLabel}
          onAction={handleEmptyAction}
        />
      ) : (
        <div className="grid gap-0">
          {renderedGroups.map((group) => {
          const rows = getCurrentVisiblePurchaseRows(group.id);
          const displayRows = preparedRows.length > 0
            ? preparedRows.filter((row) => row.status === group.id)
            : buildPurchaseDisplayRows(rows, ordersById, textbooks);
          const collapsed = Boolean(collapsedGroups[group.id]);
          const aggregateGroup = summary?.groups.find((item) => item.status === group.id) || null;
          const requestedTotal = aggregateGroup?.quantities.requested ?? null;
          const orderedTotal = aggregateGroup?.quantities.ordered ?? null;
          const receivedTotal = aggregateGroup?.quantities.received ?? null;
          const groupActionableLineIds: string[] = [];
          for (const line of rows.flatMap(getPurchaseScopeLines)) {
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
            aggregateGroup ? `${formatQuantity(aggregateGroup.totalCount)}건` : "집계 확인 필요",
            requestedTotal !== null && requestedTotal > 0 ? `요청 ${formatQuantity(requestedTotal)}` : "",
            mode === "order" && orderedTotal !== null && orderedTotal > 0 ? `주문 ${formatQuantity(orderedTotal)}` : "",
            mode === "order" && receivedTotal !== null && receivedTotal > 0 ? `입고 ${formatQuantity(receivedTotal)}` : "",
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
                <div data-testid="textbook-purchase-process-mobile-list" className={cn(DATA_TABLE_MOBILE_LIST_CLASS_NAME, "min-w-0 max-w-full overflow-hidden")}>
                  {displayRows.map((displayRow) => {
                    const line = displayRow.line;
                    const displayLines = displayRow.lines;
                    const order = ((line.order || getPurchaseLineOrder(line, ordersById)) || {}) as Row;
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
                    const ordered = getPurchaseDisplayQuantity(displayLines, "ordered");
                    const received = getPurchaseDisplayQuantity(displayLines, "received");

                    return (
                      <article key={`mobile-${displayRow.id}`} data-prepared-surface={`${mode === "request" ? "requests" : "purchase"}-mobile`} data-prepared-row-id={displayRow.id} className={DATA_TABLE_MOBILE_ITEM_CLASS_NAME} data-state={displayAllActionableSelected || displaySomeActionableSelected ? "selected" : undefined}>
                        <div className="flex min-w-0 items-start gap-3">
                          {showBulkPurchaseSelection ? (
                            <DataTableSelectionCheckbox
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
                              {canManageRequestLines && onSelectLine ? (
                                <DataTableDetailButton label={`${textbookTitle} ${mode === "request" ? "요청" : "주문·입고"} 상세 열기`} onClick={() => onSelectLine(line, order)}>{textbookTitle}</DataTableDetailButton>
                              ) : (
                                <span className="min-w-0 flex-1 whitespace-normal break-words text-sm font-semibold" title={textbookTitle}>
                                  {textbookTitle}
                                </span>
                              )}
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
                        <div className={cn("mt-3 grid gap-3 border-y border-border/60 py-3", mode === "order" ? "grid-cols-3" : "grid-cols-1")}>
                          {purchaseProcessQuantityColumns.filter(column => mode === "order" || !column.orderOnly).map(column => (
                            <div key={column.id} data-quantity-stage={column.kind} className="min-w-0 space-y-2">
                              <p className="text-xs font-medium text-muted-foreground">{column.label}</p>
                              <PurchaseQuantityPair label={column.label} student={getPurchaseDisplayScopeQuantity(displayLines, "student", column.kind)} teacher={getPurchaseDisplayScopeQuantity(displayLines, "teacher", column.kind)} />
                            </div>
                          ))}
                        </div>

                        <div className="mt-3">{renderRowActions(line, order, displayLines, textbookTitle, status, textbook)}</div>
                      </article>
                    );
                  })}
                </div>
                <DataTableViewport className="hidden [scrollbar-gutter:auto] md:block [&>[data-slot=table-container]]:overflow-visible" role="region" aria-label={`${group.title} 처리표 스크롤`} tabIndex={0}>
                  <Table
                    className={mode === "request" ? "w-full min-w-[812px] table-fixed" : "w-full min-w-[1188px] table-fixed"}
                    aria-colcount={mode === "request" ? 5 : 8 + Number(showBulkPurchaseSelection)}
                  >
                    <caption className="sr-only">{mode === "request" ? "교재 요청 처리 목록" : "교재 주문·입고 처리 목록"}</caption>
                    <colgroup>
                      {showBulkPurchaseSelection ? <col style={{ width: 40 }} /> : null}
                      <col />
                      {mode === "order" ? <col style={{ width: 104 }} /> : null}
                      {purchaseProcessQuantityColumns.filter(column => mode === "order" || !column.orderOnly).map(column => <col key={column.id} style={{ width: 104 }} />)}
                      <col style={{ width: mode === "order" ? 128 : 104 }} />
                      <col style={{ width: 184 }} /><col style={{ width: 132 }} />
                    </colgroup>
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <DataTableHeaderRow>
                        {showBulkPurchaseSelection ? (
                          <DataTableHeaderCell className="w-10 px-0">
                            <DataTableSelectionCheckbox
                              checked={groupAllActionableSelected || (groupSomeActionableSelected && "indeterminate")}
                              disabled={groupActionableLineIds.length === 0}
                              onCheckedChange={(value) => onToggleVisibleLines?.(groupActionableLineIds, value === true)}
                              title="일괄 처리 가능한 행 전체 선택"
                              aria-label="일괄 처리 가능한 행 전체 선택"
                            />
                          </DataTableHeaderCell>
                        ) : null}
                        <DataTableHeaderCell className="min-w-[288px]">교재</DataTableHeaderCell>
                        {(mode === "order") ? <DataTableHeaderCell className="w-[104px]">진행상태</DataTableHeaderCell> : null}
                        {purchaseProcessQuantityColumns.filter(column => mode === "order" || !column.orderOnly).map(column => (
                          <DataTableHeaderCell key={column.id} className="w-[104px]">{column.label}</DataTableHeaderCell>
                        ))}
                        <DataTableHeaderCell>{mode === "order" ? "총판 · 단가" : "요청자"}</DataTableHeaderCell>
                        <DataTableHeaderCell>수업 · 위치</DataTableHeaderCell>
                        <DataTableHeaderCell className={cn("w-[132px] min-w-[132px]", "text-right", stickyActionHeadClassName)}>작업</DataTableHeaderCell>
                      </DataTableHeaderRow>
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
                        const ordered = getPurchaseDisplayQuantity(displayLines, "ordered");
                        const received = getPurchaseDisplayQuantity(displayLines, "received");
                        return (
                          <DataTableBodyRow key={displayRow.id} data-prepared-surface={`${mode === "request" ? "requests" : "purchase"}-desktop`} data-prepared-row-id={displayRow.id} data-state={displayAllActionableSelected || displaySomeActionableSelected || selectedLineId === lineId || displayLineIds.includes(selectedLineId) ? "selected" : undefined}>
                            {showBulkPurchaseSelection ? (
                              <DataTableBodyCell className="px-0 py-1">
                                <DataTableSelectionCheckbox
                                  checked={displayAllActionableSelected || (displaySomeActionableSelected && "indeterminate")}
                                  disabled={displayActionableLineIds.length === 0}
                                  onCheckedChange={(value) => onToggleVisibleLines?.(displayActionableLineIds, value === true)}
                                  title={`${textbookTitle} 일괄 처리 선택`}
                                  aria-label={`${textbookTitle} 일괄 처리 선택`}
                                />
                              </DataTableBodyCell>
                            ) : null}
                            <DataTableBodyCell className="whitespace-normal break-words">
                              {canManageRequestLines && onSelectLine ? (
                                <DataTableDetailButton label={`${textbookTitle} ${mode === "request" ? "요청" : "주문·입고"} 상세 열기`} onClick={() => onSelectLine(line, order)}>{textbookTitle}</DataTableDetailButton>
                              ) : (
                                <span className="block whitespace-normal break-words font-medium" title={textbookTitle}>
                                  {textbookTitle}
                                </span>
                              )}
                              {!textbook ? (
                                <div className="text-xs text-amber-700">미등록</div>
                              ) : null}
                              <div className="text-xs text-muted-foreground">{formatCompactDateTime(getPurchaseEventAt(line, order, status))}</div>
                            </DataTableBodyCell>
                            {(mode === "order") ? (
                            <DataTableBodyCell>
                              <Badge variant="outline" className={cn("rounded-md", processStatusPillClass(status))}>
                                {purchaseStatusLabel(status, ordered, received)}
                              </Badge>
                            </DataTableBodyCell>
                            ) : null}
                            {purchaseProcessQuantityColumns.filter(column => mode === "order" || !column.orderOnly).map(column => (
                              <DataTableBodyCell key={column.id} data-quantity-stage={column.kind}>
                                <PurchaseQuantityPair label={column.label} student={getPurchaseDisplayScopeQuantity(displayLines, "student", column.kind)} teacher={getPurchaseDisplayScopeQuantity(displayLines, "teacher", column.kind)} />
                              </DataTableBodyCell>
                            ))}
                            <DataTableBodyCell className="whitespace-normal break-words">
                              {mode === "order" ? <>
                                <div>{getSupplierName(suppliers, configuredSupplierId) || "-"}</div>
                                <div className="text-xs tabular-nums text-muted-foreground">{formatPurchaseUnitCost(unitCost, textbook)}</div>
                              </> : draft.requestBy || "-"}
                            </DataTableBodyCell>
                            <DataTableBodyCell className="whitespace-normal break-words">
                              <div>{classRecord ? getClassName(classRecord) : "수업 미지정"}</div>
                              <div className="text-xs text-muted-foreground">{locationName}{mode === "order" && draft.requestBy ? ` · ${draft.requestBy}` : ""}</div>
                            </DataTableBodyCell>
                            <DataTableBodyCell className={stickyActionCellClassName}>
                              {renderRowActions(line, order, displayLines, textbookTitle, status, textbook)}
                            </DataTableBodyCell>
                          </DataTableBodyRow>
                        );
                      })}
                      <DataTableBodyRow className="bg-muted/20 text-xs text-muted-foreground">
                        {showBulkPurchaseSelection ? <DataTableBodyCell /> : null}
                        <DataTableBodyCell className="font-medium text-foreground">합계</DataTableBodyCell>
                        {(mode === "order") ? <DataTableBodyCell /> : null}
                        {purchaseProcessQuantityColumns.filter(column => mode === "order" || !column.orderOnly).map(column => (
                          <DataTableBodyCell key={column.id} data-quantity-stage={column.kind}>
                            <PurchaseQuantityPair label={`${column.label} 합계`} student={aggregateGroup?.quantities.student[column.kind] ?? null} teacher={aggregateGroup?.quantities.teacher[column.kind] ?? null} />
                          </DataTableBodyCell>
                        ))}
                        <DataTableBodyCell /><DataTableBodyCell />
                        <DataTableBodyCell className={stickyActionCellClassName} />
                      </DataTableBodyRow>
                    </TableBody>
                  </Table>
                </DataTableViewport>
                </>
              ) : null}
              {!collapsed && rows.length === 0 ? (
                <ProcessGroupEmptyState
                  label={getPurchaseProcessEmptyLabel(mode, group.id, requestFilter, orderFilter, searchQuery)}
                  hint={getPurchaseProcessEmptyHint(mode, group.id, requestFilter, orderFilter, searchQuery)}
                  actionLabel={loading || readError ? undefined : emptyActionLabel}
                  onAction={handleEmptyAction}
                />
              ) : null}
            </section>
          );
          })}
        </div>
      )}
      </div>
      </div>
    </>
  );
}

function SalesHistoryLedger({
  readFeedback,
  loading = false,
  readError = false,
  rows,
  summary,
  filters,
  onFiltersChange,
}: {
  readFeedback?: React.ReactNode;
  loading?: boolean;
  readError?: boolean;
  rows: import("./textbook-read-types").SaleHistorySummaryRow[];
  summary: import("./textbook-read-types").TextbookSaleHistorySummary | null;
  filters: import("./textbook-read-types").SaleHistoryFilters;
  onFiltersChange: (filters: import("./textbook-read-types").SaleHistoryFilters) => void;
}) {
  const yearFilter = filters.year;
  const monthFilter = filters.month;
  const classFilter = filters.classId;
  const yearOptions = summary?.yearOptions || [];
  const monthOptions = summary?.monthOptions || [];
  const classOptions = summary?.classOptions || [];

  const effectiveMonthFilter = monthFilter !== "all" && monthOptions.includes(monthFilter) ? monthFilter : "all";

  const filteredRows = rows;
  const totalIssuedQuantity = summary?.totalIssuedQuantity ?? null;
  const totalWaitingQuantity = summary?.totalWaitingQuantity ?? null;

  if (summary?.sourceTotalCount === 0 && !readError) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-background" aria-label="교재 출고 이력">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b p-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-medium">출고 이력</span>
          {readFeedback}
          {summary ? (
            <>
              <Badge variant="secondary" className="rounded-md tabular-nums">{formatQuantity(summary.totalCount)}건</Badge>
              <Badge variant="outline" className="rounded-md tabular-nums">대기 {formatQuantity(totalWaitingQuantity)}</Badge>
              <Badge variant="outline" className="rounded-md tabular-nums">완료 {formatQuantity(totalIssuedQuantity)}</Badge>
            </>
          ) : <Badge variant="outline" className="rounded-md">집계 확인 필요</Badge>}
        </div>
        <div className="grid w-full min-w-0 gap-2 sm:w-auto sm:grid-cols-3">
          <Select value={yearFilter} onValueChange={(value) => {
            onFiltersChange({ ...filters, year: value, month: "all" });
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
          <Select value={effectiveMonthFilter} onValueChange={(value) => onFiltersChange({ ...filters, month: value })}>
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
          <Select value={classFilter} onValueChange={(value) => onFiltersChange({ ...filters, classId: value })}>
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
              <TableRow key={row.id} data-prepared-surface="sales-history" data-prepared-row-id={row.id}>
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
            {filteredRows.length === 0 ? <EmptyRow colSpan={6} label={loading ? "출고 이력을 불러오는 중…" : readError ? "출고 이력을 불러오지 못했습니다" : "출고 이력이 없습니다"} compact /> : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SalesProcessTable({
  searchControl,
  readFeedback,
  summary,
  acceptedFilters,
  loading = false,
  readError = false,
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
  onInspectSale,
  onClearSearch,
}: {
  searchControl?: React.ReactNode;
  readFeedback?: React.ReactNode;
  summary: TextbookSaleSummary | null;
  acceptedFilters: SaleFilters | null;
  loading?: boolean;
  readError?: boolean;
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
  onInspectSale?: (line: Row) => void;
  onClearSearch: () => void;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [billingDialogOpen, setBillingDialogOpen] = useState(false);
  const [makeEduBillingGroups, setMakeEduBillingGroups] = useState<TextbookHandoffGroup[]>([]);
  const [billingHandoffSourceLineCount, setBillingHandoffSourceLineCount] = useState(0);
  const [billingHandoffState, setBillingHandoffState] = useState("");
  const billingAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => billingAbortRef.current?.abort(), []);
  const salesById = useMemo(() => new Map(sales.map((sale) => [getRecordId(sale), sale])), [sales]);
  const studentsById = useMemo(() => new Map(students.map((student) => [getRecordId(student), student])), [students]);
  const grouped = useMemo(() => groupSaleLinesByStatus({ lines }) as Record<string, Row[]>, [lines]);
  const selectedLineIdSet = useMemo(() => new Set(selectedLineIds), [selectedLineIds]);
  const saleRowViews = useMemo(() => {
    const views = new Map<string, { textbookTitle: string; studentName: string; className: string; locationName: string; copyScope: TextbookCopyScope; quantity: number; month: string; eventLabel: string }>();
    for (const line of lines) {
      const sale = salesById.get(text(line.sale_id || line.saleId));
      const textbook = getTextbookById(textbooks, text(line.textbook_id || line.textbookId));
      const classItem = getClassById(classes, text(line.class_id || sale?.class_id));
      const rawStatus = text(line.status || sale?.status) || "charged";
      const status = rawStatus === "paid" ? "charged" : rawStatus;
      views.set(getRecordId(line), {
        textbookTitle: textbook ? getTextbookTitle(textbook) : text(line.textbook_id),
        studentName: getSaleLineRecipientName(line, studentsById),
        className: classItem ? getClassName(classItem) : "-",
        locationName: getLocationName(locations, text(line.location_id || line.locationId || sale?.location_id || sale?.locationId)) || "-",
        copyScope: getTextbookCopyScope(line), quantity: numberValue(line.quantity) || 1,
        month: text(line.charge_month || sale?.charge_month) || "-",
        eventLabel: formatCompactDateTime(getSaleEventAt(line, sale, status)),
      });
    }
    return views;
  }, [lines, salesById, textbooks, classes, studentsById, locations]);

  const groups = useMemo(() => [
    { id: "charged", title: "출고 대기" },
    { id: "issued", title: "출고 완료" },
    { id: "cancelled", title: "취소" },
    { id: "returned", title: "반품" },
  ], []);
  const displayedFilter = acceptedFilters?.status ?? statusFilter;
  const visibleGroups = useMemo(() => (
    displayedFilter === "waiting" ? groups.filter((group) => group.id === "charged") :
    displayedFilter === "issued" ? groups.filter((group) => group.id === "issued") :
    displayedFilter === "returned" ? groups.filter((group) => group.id === "returned") :
    displayedFilter === "cancelled" ? groups.filter((group) => group.id === "cancelled") :
    groups
  ), [groups, displayedFilter]);
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
      rowsByGroup.set(group.id, grouped[group.id] || []);
    }
    return rowsByGroup;
  }, [grouped, groups]);

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

  const visibleTotalQuantity = summary?.totalQuantity ?? null;
  const visibleTotalAmount = summary?.totalAmount ?? null;
  const hasVisibleSaleRows = visibleSaleRows.length > 0;
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
  const saleProcessBusy = saving === "sale" || saving.startsWith("sale-");
  const renderedGroups = visibleGroups.filter((group) => getCurrentVisibleSaleRows(group.id).length > 0);
  const emptyGroupId = visibleGroups[0]?.id || "charged";
  const salesProcessFilterCounts = summary?.statusCounts || null;
  const hasProcessSearchQuery = Boolean(text(searchQuery));
  const filtersChanging = Boolean(acceptedFilters && (acceptedFilters.status !== statusFilter || acceptedFilters.search !== searchQuery));
  const showSalesGroupToggleControls = renderedGroups.length > 1;
  const openBillingHandoff = useCallback(() => {
    setBillingDialogOpen(true);
    setMakeEduBillingGroups([]);
    setBillingHandoffSourceLineCount(0);
    if (!acceptedFilters) { setBillingHandoffState("현재 필터가 아직 준비되지 않았습니다."); return; }
    const frozenFilters = { ...acceptedFilters };
    billingAbortRef.current?.abort();
    const abort = new AbortController();
    billingAbortRef.current = abort;
    setBillingHandoffState("전체 필터 범위를 불러오는 중");
    void getTextbookBillingHandoff(frozenFilters, { signal: abort.signal }).then((result) => {
      if (abort.signal.aborted) return;
      setMakeEduBillingGroups(result.groups);
      setBillingHandoffSourceLineCount(result.sourceLineCount);
      setBillingHandoffState(result.groups.length ? "전체 필터 범위 준비 완료" : "전체 필터 범위에 청구할 항목이 없습니다.");
    }, (error) => { if (!abort.signal.aborted) setBillingHandoffState(getTextbookActionErrorMessage(error)); });
  }, [acceptedFilters]);
  const emptyActionLabel = hasProcessSearchQuery ? "검색 초기화" : undefined;
  const emptyAction = hasProcessSearchQuery ? onClearSearch : onAddSale;

  function renderSaleActions(line: Row, status: string, studentName: string, textbookTitle: string) {
    const terminal = status === "issued" || status === "cancelled" || status === "returned";
    const busy = saleProcessBusy;
    return (
      <DataTableRowActions label={`${studentName} ${textbookTitle} 출고 더보기`} disabled={busy} primaryAction={
        !terminal ? <Button type="button" variant="outline" size="sm" aria-label={`${studentName} ${textbookTitle} 출고 완료 처리`} disabled={busy} onClick={() => onUpdateStatus(line, "issued")}>출고</Button> : undefined
      }>
        {onInspectSale ? <DropdownMenuItem aria-label={`${studentName} ${textbookTitle} 출고 상세 열기`} onSelect={() => onInspectSale(line)}>상세</DropdownMenuItem> : null}
        {!terminal ? <DropdownMenuItem aria-label={`${studentName} ${textbookTitle} 출고 전 취소`} onSelect={() => onCancelLine(line)}>출고 전 취소</DropdownMenuItem> : null}
        {status === "issued" ? <DropdownMenuItem aria-label={`${studentName} ${textbookTitle} 고객 반품`} onSelect={() => onReturnLine(line)}>고객 반품</DropdownMenuItem> : null}
        {terminal && canDeleteHistory && onDeleteLine ? <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" aria-label={`${studentName} ${textbookTitle} 출고 이력 삭제`} onSelect={() => onDeleteLine(line)}>이력 삭제</DropdownMenuItem></> : null}
      </DataTableRowActions>
    );
  }

  return (
    <>
      <TextbookHandoffDialog
        open={billingDialogOpen}
        onOpenChange={setBillingDialogOpen}
        title="메이크에듀 청구 준비"
        description="현재 필터의 전체 출고 건을 메이크에듀 기타수납 생성용 수납명, 금액, 대상 원생으로 정리합니다."
        groups={makeEduBillingGroups}
        sourceLineCount={billingHandoffSourceLineCount}
        loadState={billingHandoffState}
        onRetry={openBillingHandoff}
        emptyLabel="청구할 출고 건이 없습니다"
        idPrefix="makeedu-billing"
      />
      <div className="min-w-0" aria-label="교재 출고 목록">
      <DataTableWorkspaceToolbar feedback={readFeedback} search={searchControl}
        filters={<DataTableFilters aria-label="출고 필터">
          <DataTableSelectFilter inline id="sale-status-filter" label="상태" ariaLabel="출고 상태" value={statusFilter} onValueChange={onStatusFilterChange}
            options={salesFilterOptions.map((option) => ({ ...option, count: salesProcessFilterCounts?.[option.value] ?? null }))} />
          <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 sm:size-9" aria-label="출고 필터 초기화" disabled={statusFilter === "all"} onClick={() => onStatusFilterChange("all")}><RefreshCw className="size-4" aria-hidden="true" /></Button>
          <span role="status" className="sr-only">{saleProcessBusy ? "출고 작업 처리 중…" : loading ? "목록 불러오는 중…" : filtersChanging ? "이전 조건의 결과 표시 중" : ""}</span>
        </DataTableFilters>}
        summary={summary ? <>수량 {formatQuantity(visibleTotalQuantity)} · 청구 {formatCurrency(visibleTotalAmount)}</> : "집계 확인 필요"}
        actions={selectedActionableCount > 0 ? (<>
          <span className="mr-auto whitespace-nowrap text-sm font-medium tabular-nums">{formatQuantity(selectedActionableCount)}개 선택</span>
          {selectedIssuableCount > 0 ? <Button type="button" size="sm" variant="outline" aria-label="선택 출고 일괄 완료" disabled={saleProcessBusy} aria-busy={saving === "sale-bulk-issue"} onClick={onBulkIssue}>선택 출고</Button> : null}
          <DataTableRowActions label="선택 출고 작업" disabled={saleProcessBusy}>
            {selectedCancelableCount > 0 ? <DropdownMenuItem aria-label="선택 출고 전 취소" onSelect={onBulkCancel}>선택 취소</DropdownMenuItem> : null}
            {selectedReturnableCount > 0 ? <DropdownMenuItem aria-label="선택 고객 반품" onSelect={onBulkReturn}>선택 반품</DropdownMenuItem> : null}
            {canDeleteHistory && selectedDeletableCount > 0 && onBulkDelete ? <DropdownMenuItem variant="destructive" aria-label="선택 출고 이력 삭제" onSelect={onBulkDelete}>선택 삭제</DropdownMenuItem> : null}
          </DataTableRowActions>
          <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 sm:size-9" aria-label="출고 선택 해제" disabled={saleProcessBusy} onClick={() => onToggleVisibleLines?.(selectedLineIds, false)}><X className="size-4" /></Button>
        </>) : (<>
          {hasVisibleSaleRows && showSalesGroupToggleControls ? <DataTableRowActions label="출고 그룹 보기">
            <DropdownMenuItem aria-label="출고 그룹 전체 접기" onSelect={collapseAllGroups}>전체 접기</DropdownMenuItem>
            <DropdownMenuItem aria-label="출고 그룹 전체 펼치기" onSelect={expandAllGroups}>전체 펼치기</DropdownMenuItem>
          </DataTableRowActions> : null}
          <>
              {acceptedFilters ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  aria-label="메이크에듀 청구 준비 열기"
                  disabled={loading || filtersChanging || !hasVisibleSaleRows}
                  title="메이크에듀 청구 준비"
                  onClick={openBillingHandoff}
                >
                  <Copy className="mr-2 size-3.5" />
                  청구 준비
                </Button>
              ) : null}
              <Button type="button" size="sm" className="shrink-0" aria-label="교재 출고 추가" title="교재 출고 추가" onClick={onAddSale}>
                <Plus className="mr-2 size-4" />
                출고 추가
              </Button>
            </>

        </>)}
      />

      <div data-slot="data-table-results" className={TEXTBOOK_RESULTS_CLASS_NAME}>
      {!hasVisibleSaleRows ? (
        <ProcessGroupEmptyState
          label={loading ? "목록 불러오는 중…" : readError ? "출고 목록을 불러오지 못했습니다" : getSalesProcessEmptyLabel(emptyGroupId, statusFilter, searchQuery)}
          hint={readError ? undefined : getSalesProcessEmptyHint(emptyGroupId, displayedFilter, searchQuery)}
          actionLabel={loading || readError ? undefined : emptyActionLabel}
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

                <div data-testid="textbook-sales-process-mobile-list" className={DATA_TABLE_MOBILE_LIST_CLASS_NAME}>
                  {rows.map((line) => {
                    const lineId = getRecordId(line);
                    const view = saleRowViews.get(lineId)!;
                    const status = text(line.status) || group.id;
                    const { textbookTitle, studentName } = view;
                    const canSelectThisLine = canDeleteHistory || !["issued", "cancelled", "returned"].includes(status);
                    return (
                      <article key={lineId} data-prepared-surface="sales-process-mobile" data-prepared-row-id={lineId} className={DATA_TABLE_MOBILE_ITEM_CLASS_NAME} data-state={selectedLineIdSet.has(lineId) ? "selected" : undefined}>
                        <div className="flex min-w-0 items-start gap-2">
                          <DataTableSelectionCheckbox checked={selectedLineIdSet.has(lineId)} disabled={!canSelectThisLine} onCheckedChange={value => onToggleLine?.(lineId, value === true)} aria-label={`${studentName} ${textbookTitle} 출고 선택`} />
                          <div className="min-w-0 flex-1 space-y-1">
                            {onInspectSale ? <DataTableDetailButton label={`${studentName} ${textbookTitle} 출고 상세 열기`} onClick={() => onInspectSale(line)}>{textbookTitle}</DataTableDetailButton> : <p className="whitespace-normal break-words text-sm font-semibold">{textbookTitle}</p>}
                            <p className="break-words text-xs text-muted-foreground">{studentName} · {getTextbookCopyScopeLabel(view.copyScope)}</p>
                          </div>
                          <Badge variant="outline" className={cn("shrink-0 rounded-md", processStatusPillClass(status))}>{saleStatusLabels[status] || status}</Badge>
                        </div>
                        <div className="my-3 space-y-1 border-y py-3 text-xs text-muted-foreground">
                          <p className="break-words">{view.className} · {view.locationName}</p>
                          <div className="flex flex-wrap justify-between gap-2"><span className="tabular-nums">{view.month} · {view.eventLabel}</span><span className="font-medium text-foreground tabular-nums">{formatQuantity(view.quantity)}권</span></div>
                        </div>
                        {renderSaleActions(line, status, studentName, textbookTitle)}
                      </article>
                    );
                  })}
                </div>
                <DataTableViewport className="hidden [scrollbar-gutter:auto] md:block [&>[data-slot=table-container]]:overflow-visible" role="region" aria-label={`${group.title} 출고표 스크롤`} tabIndex={0}>
                  <Table className="w-full min-w-[944px] table-fixed">
                    <caption className="sr-only">교재 출고 처리 목록</caption>
                    <colgroup><col style={{ width: 40 }} /><col /><col style={{ width: 120 }} /><col style={{ width: 104 }} /><col style={{ width: 72 }} /><col style={{ width: 176 }} /><col style={{ width: 132 }} /></colgroup>
                    <TableHeader>
                      <DataTableHeaderRow>
                        <DataTableHeaderCell className="w-10 px-0"><DataTableSelectionCheckbox checked={groupAllSelectableSelected || (groupSomeSelectableSelected && "indeterminate")} disabled={!groupSelectableLineIds.length} onCheckedChange={value => onToggleVisibleLines?.(groupSelectableLineIds, value === true)} aria-label={canDeleteHistory ? "표시된 출고 이력 전체 선택" : "출고 대기 전체 선택"} /></DataTableHeaderCell>
                        <DataTableHeaderCell className="min-w-[240px]">교재</DataTableHeaderCell>
                        <DataTableHeaderCell className="w-[136px]">대상</DataTableHeaderCell>
                        <DataTableHeaderCell className="w-[110px]">진행상태</DataTableHeaderCell>
                        <DataTableHeaderCell className="w-[72px] text-right">수량</DataTableHeaderCell>
                        <DataTableHeaderCell className="w-[184px]">수업 · 위치</DataTableHeaderCell>
                        <DataTableHeaderCell className={cn("w-[132px] text-right", stickyActionHeadClassName)}>작업</DataTableHeaderCell>
                      </DataTableHeaderRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((line) => {
                        const lineId = getRecordId(line);
                        const view = saleRowViews.get(lineId)!;
                        const { textbookTitle, studentName } = view;
                        const status = text(line.status) || group.id;
                        const canSelectThisLine = canDeleteHistory || !["issued", "cancelled", "returned"].includes(status);
                        return (
                          <DataTableBodyRow key={lineId} data-state={selectedLineIdSet.has(lineId) ? "selected" : undefined} data-prepared-surface="sales-process-desktop" data-prepared-row-id={lineId}>
                            <DataTableBodyCell className="px-0 py-1"><DataTableSelectionCheckbox checked={selectedLineIdSet.has(lineId)} disabled={!canSelectThisLine} onCheckedChange={value => onToggleLine?.(lineId, value === true)} aria-label={`${studentName} ${textbookTitle} 출고 선택`} /></DataTableBodyCell>
                            <DataTableBodyCell wrap>
                              {onInspectSale ? <DataTableDetailButton label={`${studentName} ${textbookTitle} 출고 상세 열기`} onClick={() => onInspectSale(line)}>{textbookTitle}</DataTableDetailButton> : <div className="max-w-[360px] break-words font-medium">{textbookTitle}</div>}
                              <p className="text-xs text-muted-foreground">{view.eventLabel}</p>
                            </DataTableBodyCell>
                            <DataTableBodyCell wrap><div>{studentName}</div><div className="text-xs text-muted-foreground">{getTextbookCopyScopeLabel(view.copyScope)}</div></DataTableBodyCell>
                            <DataTableBodyCell><Badge variant="outline" className={cn("rounded-md", processStatusPillClass(status))}>{saleStatusLabels[status] || status}</Badge></DataTableBodyCell>
                            <DataTableBodyCell className="text-right tabular-nums">{formatQuantity(view.quantity)}</DataTableBodyCell>
                            <DataTableBodyCell wrap><div>{view.className}</div><div className="text-xs text-muted-foreground">{view.locationName} · {view.month}</div></DataTableBodyCell>


                            <DataTableBodyCell className={cn(stickyActionCellClassName, "group-hover/data-table-row:bg-muted group-data-[state=selected]/data-table-row:bg-accent")}>{renderSaleActions(line, status, studentName, textbookTitle)}</DataTableBodyCell>
                          </DataTableBodyRow>
                        );
                      })}
                      <TableRow className="bg-muted/20 text-xs text-muted-foreground">
                        <TableCell colSpan={4} className="text-right">이 페이지 합계</TableCell>
                        <TableCell className="text-right tabular-nums">{formatQuantity(totalQuantity)}</TableCell>
                        <TableCell colSpan={2} />
                      </TableRow>
                    </TableBody>
                  </Table>
                </DataTableViewport>
                </>
              ) : null}
              {!collapsed && totalCount === 0 ? (
                <ProcessGroupEmptyState
                  label={getSalesProcessEmptyLabel(group.id, statusFilter, searchQuery)}
                  hint={getSalesProcessEmptyHint(group.id, statusFilter, searchQuery)}
                  actionLabel={loading || readError ? undefined : emptyActionLabel}
                  onAction={emptyAction}
                />
              ) : null}
            </section>
          );
          })}
        </div>
      )}
      </div>
      </div>
    </>
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
