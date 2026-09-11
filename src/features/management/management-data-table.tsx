"use client";
"use no memo";

import {
  type ChangeEvent,
  type CompositionEvent,
  type CSSProperties,
  type ReactNode,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnOrderState,
  type ColumnSizingState,
  type ExpandedState,
  type GroupingState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getGroupedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTableSelectionCheckbox } from "@/components/data-table/data-table-selection";
import { StudentRowActions } from "./student-row-actions";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableHeader,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DataTableSettings, DataTableSettingsSection, DataTableSettingsSelect, DataTableColumnSetting } from "@/components/data-table/data-table-settings";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import {
  DATA_TABLE_LAYOUT_CLASS_NAME,
  DATA_TABLE_MOBILE_LIST_CLASS_NAME,
  DATA_TABLE_PAGER_CLASS_NAME,
  DATA_TABLE_TABLE_CLASS_NAME,
  DATA_TABLE_TOOLBAR_CLASS_NAME,
  DataTableBodyCell,
  DataTableBodyRow,
  DataTableHeaderCell,
  DataTableHeaderRow,
  type DataTablePinnedColumn,
  DataTableSortButton,
  DataTableToolbar,
  DataTableFilters,
  DATA_TABLE_FILTER_FIELD_CLASS_NAME,
  DataTableViewport,
} from "@/components/data-table/data-table-surface";
import { MANAGEMENT_NUMBERED_SORT_COLUMNS, type ManagementNumberedSort } from "./management-numbered-service";
import { MANAGEMENT_TABLE_STORAGE_VERSION, managementTableStorageKey, resetManagementPageForFilters } from "./management-numbered-state";
import { STUDENT_STATUS_OPTIONS } from "@/lib/student-status";
import type { ManagementKind, ManagementRow, ManagementStat } from "@/features/management/use-management-records";
import {
  getManagementListViewportHeight,
  type ManagementListPageSize,
} from "./management-page-size";
import {
  ClassFilterPanel,
  type ClassFilterPanelSelect,
} from "./class-filter-panel";
import {
  formatClassScheduleDisplayLines,
  splitClassResourceDisplayValues,
} from "./class-schedule-slots";
import {
  ClassEnrollmentStatusCell,
  type ClassRosterMode,
} from "./class-enrollment-status-cell";
import {
  formatStudentSchoolCategoryLabel,
  reconcilePendingManagementFilters,
  reconcilePendingManagementSearch,
  replaceManagementListUrl,
  shouldRenderManagementInitialLoading,
  sortStudentSchoolCategoryValues,
} from "./management-filter-transition.js";

const STORAGE_VERSION = MANAGEMENT_TABLE_STORAGE_VERSION;

const STUDENT_TABLE_COLUMN_IDS = [
  "select",
  "title",
  "school",
  "grade",
  "contact",
  "parentContact",
  "status",
  "action",
] as const;

const CLASS_TABLE_COLUMN_IDS = [
  "select",
  "subject",
  "grade",
  "title",
  "schedule",
  "teacher",
  "classroom",
  "enrollmentStatus",
  "capacity",
  "weeklyHours",
  "tuition",
] as const;

const CLASS_MANAGEMENT_COLUMN_IDS = [
  ...CLASS_TABLE_COLUMN_IDS,
  "status",
] as const;

const CLASS_FILTERS = [
  { id: "subject", label: "과목" },
  { id: "grade", label: "학년" },
  { id: "teacher", label: "선생님" },
  { id: "classroom", label: "강의실" },
] as const;

type ClassFilterColumnId = (typeof CLASS_FILTERS)[number]["id"];

const DEFAULT_CLASS_STATUS_FILTER = "수강";
const CLASS_STATUS_FILTER_OPTIONS = ["수강", "개강 준비", "종강"] as const;

const CLASS_LIST_QUERY_PARAM_KEYS = {
  q: "q",
  status: "status",
  subject: "subject",
  grade: "grade",
  teacher: "teacher",
  classroom: "classroom",
} as const;

type ClassListQueryState = {
  q: string;
  status: string;
  subject: string;
  grade: string;
  teacher: string;
  classroom: string;
};

const EMPTY_CLASS_LIST_QUERY_STATE: ClassListQueryState = {
  q: "",
  status: "",
  subject: "",
  grade: "",
  teacher: "",
  classroom: "",
};

const STUDENT_SCHOOL_CATEGORY_OPTIONS = ["고등", "중등", "초등"] as const;
const STUDENT_STATUS_SORT_ORDER = ["재원", "퇴원"] as const;

const STUDENT_LIST_QUERY_PARAM_KEYS = {
  q: "q",
  status: "status",
  schoolCategory: "schoolCategory",
  school: "school",
  grade: "grade",
} as const;

type StudentListQueryState = {
  q: string;
  status: string;
  schoolCategory: string;
  school: string;
  grade: string;
};

const EMPTY_STUDENT_LIST_QUERY_STATE: StudentListQueryState = {
  q: "",
  status: "",
  schoolCategory: "",
  school: "",
  grade: "",
};

const TEXTBOOK_LIST_QUERY_PARAM_KEYS = {
  q: "q",
  status: "status",
  subject: "subject",
  publisher: "publisher",
} as const;

type TextbookListQueryState = {
  q: string;
  status: string;
  subject: string;
  publisher: string;
};

const EMPTY_TEXTBOOK_LIST_QUERY_STATE: TextbookListQueryState = {
  q: "",
  status: "",
  subject: "",
  publisher: "",
};

const MANAGEMENT_SCROLL_STORAGE_PREFIX = "tips:management-table-scroll:";

const TEXTBOOK_TABLE_COLUMN_IDS = [
  "select",
  "title",
  "subject",
  "publisher",
  "price",
  "updatedAt",
  "status",
  "action",
] as const;

const TABLE_COLUMN_IDS_BY_KIND: Record<ManagementKind, readonly string[]> = {
  students: STUDENT_TABLE_COLUMN_IDS,
  classes: CLASS_MANAGEMENT_COLUMN_IDS,
  textbooks: TEXTBOOK_TABLE_COLUMN_IDS,
};

const USER_FACING_COLUMN_IDS = new Set<string>([
  ...STUDENT_TABLE_COLUMN_IDS,
  ...CLASS_TABLE_COLUMN_IDS,
  ...TEXTBOOK_TABLE_COLUMN_IDS,
  "subtitle",
  "badge",
  "metaSummary",
]);

const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  select: 40,
  title: 220,
  school: 140,
  grade: 92,
  contact: 148,
  parentContact: 164,
  subject: 112,
  schedule: 220,
  teacher: 120,
  classroom: 120,
  enrollmentStatus: 180,
  capacity: 92,
  weeklyHours: 132,
  tuition: 128,
  publisher: 150,
  price: 112,
  updatedAt: 132,
  status: 132,
  action: 72,
  badge: 112,
  subtitle: 180,
  metaSummary: 220,
};

const DEFAULT_TABLE_CONFIG: Record<
  ManagementKind,
  {
    visibleColumnIds: string[];
    sorting: SortingState;
    grouping: GroupingState;
  }
> = {
  students: {
    visibleColumnIds: [...STUDENT_TABLE_COLUMN_IDS],
    sorting: [
      { id: "status", desc: false },
      { id: "title", desc: false },
    ],
    grouping: [],
  },
  classes: {
    visibleColumnIds: [...CLASS_TABLE_COLUMN_IDS],
    sorting: [
      { id: "title", desc: false },
    ],
    grouping: [],
  },
  textbooks: {
    visibleColumnIds: [...TEXTBOOK_TABLE_COLUMN_IDS],
    sorting: [
      { id: "subject", desc: false },
      { id: "title", desc: false },
    ],
    grouping: ["subject"],
  },
};

type SavedPreferences = {
  version: number;
  columnVisibility: VisibilityState;
  columnOrder: ColumnOrderState;
  columnSizing: ColumnSizingState;
  sorting: SortingState;
  grouping: GroupingState;
};

type ColumnOption = {
  id: string;
  label: string;
};

type ManagementTableActions = {
  onCreate?: () => void;
  onOpenRow?: (row: ManagementRow) => void;
  onDeleteRow?: (row: ManagementRow) => void;
  onBulkUpdateRows?: (rows: ManagementRow[], change: { field: string; value: string }) => Promise<void> | void;
  onBulkDeleteRows?: (rows: ManagementRow[]) => Promise<void> | void;
  onOpenSchoolMaster?: () => void;
  onOpenTeacherMaster?: () => void;
  onOpenClassroomMaster?: () => void;
  onLoadClassRoster?: (classId: string, mode: ClassRosterMode) => Promise<unknown[]>;
};

type StoredManagementScroll = {
  pageY: number;
  tableX: number;
  tableY: number;
};

type BulkEditField = {
  id: string;
  label: string;
  placeholder: string;
  options?: string[];
};

const BULK_EDIT_FIELDS: Record<ManagementKind, BulkEditField[]> = {
  students: [
    { id: "status", label: "재원 상태", placeholder: "재원", options: Array.from(STUDENT_STATUS_OPTIONS) },
    { id: "school_category", label: "학교 구분", placeholder: "고등/중등/초등", options: Array.from(STUDENT_SCHOOL_CATEGORY_OPTIONS) },
    { id: "school", label: "학교", placeholder: "학교명" },
    { id: "grade", label: "학년", placeholder: "고1" },
  ],
  classes: [
    { id: "status", label: "수업 상태", placeholder: "수강", options: Array.from(CLASS_STATUS_FILTER_OPTIONS) },
    { id: "subject", label: "과목", placeholder: "영어" },
    { id: "teacher", label: "선생님", placeholder: "선생님명" },
    { id: "classroom", label: "강의실", placeholder: "강의실" },
  ],
  textbooks: [
    { id: "status", label: "상태", placeholder: "사용중" },
    { id: "publisher", label: "출판사", placeholder: "출판사" },
  ],
};

function getStatusColor(value: string) {
  if (value === "재원" || value === "수강" || value === "수업 진행 중" || value === "assigned" || value === "has-lessons") {
    return "text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/20";
  }

  if (value === "개강 준비" || value === "개강 준비 중" || value === "waitlist") {
    return "text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-900/20";
  }

  if (value === "퇴원" || value === "unassigned" || value === "no-lessons" || value === "종강") {
    return "text-gray-600 bg-gray-50 dark:text-gray-400 dark:bg-gray-900/20";
  }

  return "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/20";
}

function prettifyColumnKey(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
}

function formatColumnLabel(columnId: string, badgeLabel: string, statusLabel: string, kind?: ManagementKind) {
  if (columnId === "title") return kind === "classes" ? "수업명" : "이름";
  if (columnId === "subtitle") return "기본 정보";
  if (columnId === "badge") return badgeLabel;
  if (columnId === "status") return statusLabel;
  if (columnId === "metaSummary") return "상세";
  if (columnId === "subject") return "과목";
  if (columnId === "school") return "학교";
  if (columnId === "grade") return "학년";
  if (columnId === "contact") return "연락처";
  if (columnId === "parentContact") return "학부모 연락처";
  if (columnId === "publisher") return "출판사";
  if (columnId === "price") return "가격";
  if (columnId === "updatedAt") return "수정일";
  if (columnId === "schedule") return "요일/시간";
  if (columnId === "teacher") return "선생님";
  if (columnId === "classroom") return "강의실";
  if (columnId === "enrollmentStatus") return "수강 현황";
  if (columnId === "capacity") return "정원";
  if (columnId === "weeklyHours") return "주간 수업시간";
  if (columnId === "tuition") return "수업료";
  if (columnId === "action") return "컬럼 구성";
  return prettifyColumnKey(columnId);
}

function getPinnedColumn(columnId: string, surface: "header" | "body"): DataTablePinnedColumn | undefined {
  if (columnId === "select") {
    return { left: 0, layer: surface === "header" ? 40 : 20 };
  }
  if (columnId === "title") {
    return { left: 40, layer: surface === "header" ? 30 : 10 };
  }
  return undefined;
}

function getColumnSizeStyle(size: number) {
  return {
    width: `${size}px`,
    minWidth: `${Math.min(size, 72)}px`,
  };
}

function getKindColumnIds(kind: ManagementKind) {
  return new Set<string>(TABLE_COLUMN_IDS_BY_KIND[kind]);
}

function normalizeColumnWidth(value: unknown, fallback: number) {
  const width = Number(value);
  if (!Number.isFinite(width)) {
    return fallback;
  }
  return Math.min(420, Math.max(72, Math.round(width)));
}

function normalizeScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeScalar(entry)).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[object]";
    }
  }
  return String(value);
}

function getClassListQueryState(params: URLSearchParams): ClassListQueryState {
  return {
    q: normalizeScalar(params.get(CLASS_LIST_QUERY_PARAM_KEYS.q)),
    status: normalizeScalar(params.get(CLASS_LIST_QUERY_PARAM_KEYS.status)),
    subject: normalizeScalar(params.get(CLASS_LIST_QUERY_PARAM_KEYS.subject)),
    grade: normalizeScalar(params.get(CLASS_LIST_QUERY_PARAM_KEYS.grade)),
    teacher: normalizeScalar(params.get(CLASS_LIST_QUERY_PARAM_KEYS.teacher)),
    classroom: normalizeScalar(params.get(CLASS_LIST_QUERY_PARAM_KEYS.classroom)),
  };
}

function setClassListQueryParam(params: URLSearchParams, key: string, value: string, defaultValue = "") {
  const normalized = normalizeScalar(value);
  if (!normalized || normalized === defaultValue) {
    params.delete(key);
    return;
  }

  params.set(key, normalized);
}

function buildClassListHref(pathname: string, searchParamString: string, state: ClassListQueryState) {
  const params = new URLSearchParams(searchParamString);
  params.delete("period");
  const previousSearch = params.toString();

  setClassListQueryParam(params, CLASS_LIST_QUERY_PARAM_KEYS.q, state.q);
  setClassListQueryParam(params, CLASS_LIST_QUERY_PARAM_KEYS.status, state.status, DEFAULT_CLASS_STATUS_FILTER);
  setClassListQueryParam(params, CLASS_LIST_QUERY_PARAM_KEYS.subject, state.subject);
  setClassListQueryParam(params, CLASS_LIST_QUERY_PARAM_KEYS.grade, state.grade);
  setClassListQueryParam(params, CLASS_LIST_QUERY_PARAM_KEYS.teacher, state.teacher);
  setClassListQueryParam(params, CLASS_LIST_QUERY_PARAM_KEYS.classroom, state.classroom);
  resetManagementPageForFilters("classes", previousSearch, params);

  const nextQuery = params.toString();
  return nextQuery ? `${pathname}?${nextQuery}` : pathname;
}

function getStudentListQueryState(params: URLSearchParams): StudentListQueryState {
  return {
    q: normalizeScalar(params.get(STUDENT_LIST_QUERY_PARAM_KEYS.q)),
    status: normalizeScalar(params.get(STUDENT_LIST_QUERY_PARAM_KEYS.status)),
    schoolCategory: normalizeScalar(params.get(STUDENT_LIST_QUERY_PARAM_KEYS.schoolCategory)),
    school: normalizeScalar(params.get(STUDENT_LIST_QUERY_PARAM_KEYS.school)),
    grade: normalizeScalar(params.get(STUDENT_LIST_QUERY_PARAM_KEYS.grade)),
  };
}

function buildStudentListHref(pathname: string, searchParamString: string, state: StudentListQueryState) {
  const params = new URLSearchParams(searchParamString);

  setClassListQueryParam(params, STUDENT_LIST_QUERY_PARAM_KEYS.q, state.q);
  setClassListQueryParam(params, STUDENT_LIST_QUERY_PARAM_KEYS.status, state.status);
  setClassListQueryParam(params, STUDENT_LIST_QUERY_PARAM_KEYS.schoolCategory, state.schoolCategory);
  setClassListQueryParam(params, STUDENT_LIST_QUERY_PARAM_KEYS.school, state.school);
  setClassListQueryParam(params, STUDENT_LIST_QUERY_PARAM_KEYS.grade, state.grade);
  resetManagementPageForFilters("students", searchParamString, params);

  const nextQuery = params.toString();
  return nextQuery ? `${pathname}?${nextQuery}` : pathname;
}

function getTextbookListQueryState(params: URLSearchParams): TextbookListQueryState {
  return {
    q: normalizeScalar(params.get(TEXTBOOK_LIST_QUERY_PARAM_KEYS.q)),
    status: normalizeScalar(params.get(TEXTBOOK_LIST_QUERY_PARAM_KEYS.status)),
    subject: normalizeScalar(params.get(TEXTBOOK_LIST_QUERY_PARAM_KEYS.subject)),
    publisher: normalizeScalar(params.get(TEXTBOOK_LIST_QUERY_PARAM_KEYS.publisher)),
  };
}

function buildTextbookListHref(pathname: string, searchParamString: string, state: TextbookListQueryState) {
  const params = new URLSearchParams(searchParamString);
  setClassListQueryParam(params, TEXTBOOK_LIST_QUERY_PARAM_KEYS.q, state.q);
  setClassListQueryParam(params, TEXTBOOK_LIST_QUERY_PARAM_KEYS.status, state.status);
  setClassListQueryParam(params, TEXTBOOK_LIST_QUERY_PARAM_KEYS.subject, state.subject);
  setClassListQueryParam(params, TEXTBOOK_LIST_QUERY_PARAM_KEYS.publisher, state.publisher);
  resetManagementPageForFilters("textbooks", searchParamString, params);
  const nextQuery = params.toString();
  return nextQuery ? `${pathname}?${nextQuery}` : pathname;
}

function getManagementListQueryString(searchParamString: string) {
  const params = new URLSearchParams(searchParamString);
  params.delete("classId");
  params.delete("studentId");
  params.delete("tab");
  params.delete("section");
  params.delete("sessionId");
  params.delete("returnTo");
  params.sort();

  return params.toString();
}

function getManagementListScrollStorageKey(kind: ManagementKind, pathname: string, searchParamString: string) {
  const nextQuery = getManagementListQueryString(searchParamString);
  return `${MANAGEMENT_SCROLL_STORAGE_PREFIX}${kind}:${pathname}${nextQuery ? `?${nextQuery}` : ""}`;
}

function parseStoredManagementScroll(rawValue: string | null): StoredManagementScroll | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<StoredManagementScroll>;
    const pageY = Number(parsed.pageY || 0);
    const tableX = Number(parsed.tableX || 0);
    const tableY = Number(parsed.tableY || 0);

    if (!Number.isFinite(pageY) && !Number.isFinite(tableX)) {
      return null;
    }

    return {
      pageY: Number.isFinite(pageY) ? Math.max(0, pageY) : 0,
      tableX: Number.isFinite(tableX) ? Math.max(0, tableX) : 0,
      tableY: Number.isFinite(tableY) ? Math.max(0, tableY) : 0,
    };
  } catch {
    return null;
  }
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debouncedValue;
}

function compareStudentStatusForTable(left: unknown, right: unknown) {
  const leftValue = normalizeScalar(left);
  const rightValue = normalizeScalar(right);
  const leftRank = STUDENT_STATUS_SORT_ORDER.indexOf(leftValue as (typeof STUDENT_STATUS_SORT_ORDER)[number]);
  const rightRank = STUDENT_STATUS_SORT_ORDER.indexOf(rightValue as (typeof STUDENT_STATUS_SORT_ORDER)[number]);
  const normalizedLeftRank = leftRank === -1 ? STUDENT_STATUS_SORT_ORDER.length : leftRank;
  const normalizedRightRank = rightRank === -1 ? STUDENT_STATUS_SORT_ORDER.length : rightRank;

  if (normalizedLeftRank !== normalizedRightRank) {
    return normalizedLeftRank - normalizedRightRank;
  }

  return leftValue.localeCompare(rightValue, "ko", { numeric: true });
}

function formatDelimitedLabel(value: unknown) {
  return normalizeScalar(value).replace(/\s*,\s*/g, ", ");
}

function getClassFilterValue(row: ManagementRow, columnId: ClassFilterColumnId) {
  const raw = row.raw || {};
  if (columnId === "subject") return normalizeScalar(raw.subject || row.badge);
  if (columnId === "grade") return normalizeScalar(raw.grade);
  if (columnId === "teacher") return normalizeScalar(raw.teacher || raw.teacher_name || raw.teacherName);
  return normalizeScalar(raw.classroom || raw.room);
}

function splitClassFilterValue(value: string, columnId: ClassFilterColumnId) {
  const normalized = normalizeScalar(value);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/[,，/]+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .map((part) => (columnId === "classroom" ? part.replace(/\([^)]*\)/g, "").trim() : part))
    .filter(Boolean);
}

function getClassFilterValues(row: ManagementRow, columnId: ClassFilterColumnId) {
  const value = getClassFilterValue(row, columnId);
  if (columnId === "teacher" || columnId === "classroom") {
    return splitClassFilterValue(value, columnId);
  }
  return value ? [value] : [];
}

function getManagementTeacherCatalogRows(rows: ManagementRow[]) {
  const byIdOrName = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const raw = row.raw || {};
    const catalogs = Array.isArray(raw.available_teacher_catalogs)
      ? raw.available_teacher_catalogs
      : Array.isArray(raw.availableTeacherCatalogs)
        ? raw.availableTeacherCatalogs
        : [];
    for (const catalog of catalogs) {
      if (!catalog || typeof catalog !== "object") continue;
      const catalogRow = catalog as Record<string, unknown>;
      const name = normalizeScalar(catalogRow.name);
      const key = normalizeScalar(catalogRow.id) || name;
      if (!key || !name) continue;
      byIdOrName.set(key, catalogRow);
    }
  }
  return [...byIdOrName.values()];
}

function normalizeManagementTeacherSubjects(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(normalizeScalar).filter(Boolean);
  }
  return splitClassFilterValue(normalizeScalar(value), "teacher");
}

function normalizeManagementSubjectToken(value: unknown) {
  return normalizeScalar(value).replace(/\s+/g, "").replace(/(과목|팀)$/g, "");
}

function matchesManagementTeacherSubject(catalog: Record<string, unknown>, subject: string) {
  const selectedSubject = normalizeScalar(subject);
  if (!selectedSubject) return true;
  const subjects = normalizeManagementTeacherSubjects(catalog.subjects);
  if (subjects.length === 0) return true;
  const selectedToken = normalizeManagementSubjectToken(selectedSubject);
  return subjects.some((catalogSubject) => (
    catalogSubject === selectedSubject || normalizeManagementSubjectToken(catalogSubject) === selectedToken
  ));
}

function getManagementTeacherCatalogOptions(rows: ManagementRow[], subject: string) {
  return getManagementTeacherCatalogRows(rows)
    .filter((catalog) => catalog.is_visible !== false && matchesManagementTeacherSubject(catalog, subject))
    .sort((left, right) => Number(left.sort_order || left.sortOrder || 0) - Number(right.sort_order || right.sortOrder || 0) || normalizeScalar(left.name).localeCompare(normalizeScalar(right.name), "ko", { numeric: true }))
    .map((catalog) => normalizeScalar(catalog.name))
    .filter(Boolean);
}

function sortClassFilterOptions(columnId: ClassFilterColumnId, values: string[]) {
  if (columnId !== "subject") {
    return [...values].sort((a, b) => a.localeCompare(b, "ko"));
  }

  const preferredOrder = ["영어", "수학"];
  return [...values].sort((a, b) => {
    const aIndex = preferredOrder.indexOf(a);
    const bIndex = preferredOrder.indexOf(b);
    if (aIndex !== -1 || bIndex !== -1) {
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    }
    return a.localeCompare(b, "ko");
  });
}

function sortStudentSchoolCategories(values: string[]) {
  return sortStudentSchoolCategoryValues(values);
}

function sortStudentGradeOptions(values: string[]) {
  return [...values].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
}

function getClassStatusFilterValue(row: ManagementRow) {
  const status = normalizeScalar((row.raw || {}).status || row.status || row.statusValue);

  if (status.includes("종강") || status.toLowerCase() === "ended") {
    return "종강";
  }

  if (status.includes("준비") || status.includes("예정") || status.toLowerCase() === "preparing") {
    return "개강 준비";
  }

  return "수강";
}

function getClassCapacity(row: ManagementRow) {
  const raw = row.raw || {};
  const capacity = Number(raw.capacity || row.metrics.capacity || 0);
  return Number.isFinite(capacity) && capacity > 0 ? capacity : 0;
}

function formatManagementCurrency(value: unknown) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "-";
  }
  return `${new Intl.NumberFormat("ko-KR").format(amount)}원`;
}

function normalizeClassScheduleMeta(value: unknown) {
  return formatDelimitedLabel(value).replace(/\s+/g, " ").trim();
}

function formatClassScheduleLineForList(line: string, row: ManagementRow) {
  const raw = row.raw || {};
  const teacher = normalizeClassScheduleMeta(raw.teacher || raw.teacher_name || raw.teacherName);
  const classroom = normalizeClassScheduleMeta(raw.classroom || raw.room);
  const expectedScheduleMeta = [teacher, classroom].filter(Boolean).join(", ");
  if (!expectedScheduleMeta) {
    return line;
  }

  return line.replace(/\s*\(([^()]*)\)\s*$/, (match, slotMeta) => {
    if (normalizeClassScheduleMeta(slotMeta) !== normalizeClassScheduleMeta(expectedScheduleMeta)) {
      return match;
    }
    return "";
  });
}

function renderClassScheduleCell(row: ManagementRow) {
  const scheduleLines = Array.isArray((row.raw || {}).scheduleLines)
    ? ((row.raw || {}).scheduleLines as string[])
    : Array.isArray((row.raw || {}).schedule_lines)
      ? ((row.raw || {}).schedule_lines as string[])
      : [];
  const scheduleValue = scheduleLines.length > 0
    ? scheduleLines.join("\n")
    : normalizeScalar((row.raw || {}).schedule);
  const lines = formatClassScheduleDisplayLines(scheduleValue);
  if (lines.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }
  return (
    <div className="grid min-w-[11rem] gap-1 py-0.5 text-sm text-foreground">
      {lines.map((line, index) => (
        <span key={`${row.id}-schedule-${index}`} className="leading-5">
          {formatClassScheduleLineForList(line, row)}
        </span>
      ))}
    </div>
  );
}

type StudentClassSummary = {
  id?: string;
  name?: string;
  subject?: string;
  teacher?: string;
  schedule?: string;
  classroom?: string;
};

function normalizeStudentClassSummaries(value: unknown): StudentClassSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return {
          id: normalizeScalar(record.id),
          name: normalizeScalar(record.name || record.title || record.className || record.class_name),
          subject: normalizeScalar(record.subject),
          teacher: normalizeScalar(record.teacher || record.teacher_name || record.teacherName),
          schedule: normalizeScalar(record.schedule),
          classroom: normalizeScalar(record.classroom || record.room),
        };
      }

      return {
        id: normalizeScalar(item),
        name: normalizeScalar(item),
      };
    })
    .filter((classItem) => classItem.name || classItem.id);
}

function getStudentClassSummaries(row: ManagementRow, status: "registered" | "waitlist") {
  const raw = row.raw || {};
  const summaryValue = status === "registered"
    ? raw.enrolledClasses || raw.enrolled_classes
    : raw.waitlistClasses || raw.waitlist_classes;
  const summaryList = normalizeStudentClassSummaries(summaryValue);
  if (summaryList.length > 0) {
    return summaryList;
  }

  const idValue = status === "registered"
    ? raw.class_ids || raw.classIds
    : raw.waitlist_class_ids || raw.waitlistClassIds;
  return normalizeStudentClassSummaries(Array.isArray(idValue) ? idValue : []);
}

function formatStudentClassSummary(classItem: StudentClassSummary) {
  const title = classItem.name || classItem.id || "수업";
  const meta = [classItem.subject, classItem.teacher, classItem.classroom].filter(Boolean).join(" · ");
  return { title, meta, schedule: classItem.schedule || "" };
}

function renderStudentClassStatusPopover(row: ManagementRow) {
  const registeredCount = Number(row.metrics.classCount || 0);
  const waitlistCount = Number(row.metrics.waitlistCount || 0);
  const mode = registeredCount > 0 ? "registered" : waitlistCount > 0 ? "waitlist" : "none";
  const lifecycleBadge = (
    row.status === "재원" ? (
      <span className="px-1 text-xs text-muted-foreground">{row.status}</span>
    ) : (
      <Badge variant="secondary" className={getStatusColor(row.statusValue || row.status)}>
        {row.status}
      </Badge>
    )
  );

  if (mode === "none") {
    return lifecycleBadge;
  }

  const label = mode === "registered" ? "수강" : "대기";
  const count = mode === "registered" ? registeredCount : waitlistCount;
  const classList = getStudentClassSummaries(row, mode);
  const sortedClassList = [...classList].sort((a, b) =>
    (a.name || a.id || "").localeCompare(b.name || b.id || "", "ko", { numeric: true }),
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {lifecycleBadge}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "relative z-20 h-6 rounded-full px-2.5 text-xs font-medium",
              mode === "registered"
                ? "bg-muted/60 text-foreground hover:bg-muted"
                : "bg-orange-50 text-orange-700 hover:bg-orange-100 dark:bg-orange-950/30 dark:text-orange-300 dark:hover:bg-orange-950/50",
            )}
            aria-label={`${row.title} ${label} 수업 ${count}개 보기`}
            onClick={(event) => event.stopPropagation()}
          >
            {label} {count}개
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} className="w-72 rounded-lg p-0 shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="text-sm font-semibold">{label} 수업</div>
            <Badge variant="secondary" className="h-5 rounded-full px-2 text-[11px]">
              {count}개
            </Badge>
          </div>
          <div className="max-h-72 overflow-y-auto p-2">
            {sortedClassList.length > 0 ? (
              <div className="grid gap-1">
                {sortedClassList.map((classItem, index) => {
                  const formatted = formatStudentClassSummary(classItem);
                  return (
                    <div
                      key={`${row.id}-${mode}-${classItem.id || classItem.name || index}`}
                      className="rounded-md px-2 py-1.5 hover:bg-muted/70"
                    >
                      <div className="truncate text-sm font-medium">{formatted.title}</div>
                      {formatted.meta ? <div className="truncate text-xs text-muted-foreground">{formatted.meta}</div> : null}
                      {formatted.schedule ? <div className="truncate text-xs text-muted-foreground">{formatted.schedule}</div> : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-2 py-5 text-center text-sm text-muted-foreground">
                표시할 수업이 없습니다.
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function renderClassCapacityCell(row: ManagementRow) {
  const capacity = getClassCapacity(row);
  return capacity > 0 ? <span className="text-sm text-foreground">{capacity}</span> : null;
}

function getClassEnrollmentStatusCellKey(row: ManagementRow) {
  const raw = row.raw || {};
  return [
    row.id,
    raw.registeredCount || raw.registered_count || row.metrics.studentCount || 0,
    raw.waitlistCount || raw.waitlist_count || row.metrics.waitlistCount || 0,
  ].join(":");
}

function renderPlainCell(value: unknown, className = "text-sm text-foreground") {
  const normalized = normalizeScalar(value);
  if (!normalized) {
    return <span className="text-muted-foreground">-</span>;
  }
  return <span className={className}>{normalized}</span>;
}

function renderClassResourceCell(value: unknown) {
  const values = splitClassResourceDisplayValues(value);
  if (values.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }
  return (
    <div className="grid gap-1 py-0.5 text-sm text-foreground">
      {values.map((item, index) => (
        <span key={`${item}-${index}`} className="leading-5">{item}</span>
      ))}
    </div>
  );
}

function buildDefaultVisibility(kind: ManagementKind, columnIds: string[]) {
  const recommendedVisibleColumnIds = new Set(DEFAULT_TABLE_CONFIG[kind].visibleColumnIds);
  const visibility: VisibilityState = {};

  for (const columnId of columnIds) {
    if (columnId === "select" || columnId === "action") {
      visibility[columnId] = true;
      continue;
    }

    visibility[columnId] = recommendedVisibleColumnIds.has(columnId);
  }

  return visibility;
}

function buildDefaultSorting(kind: ManagementKind, columnIds: string[]) {
  const allowedColumnIds = new Set(columnIds);
  return DEFAULT_TABLE_CONFIG[kind].sorting.filter((item) => allowedColumnIds.has(item.id));
}

function buildDefaultGrouping(kind: ManagementKind, columnIds: string[]) {
  const allowedColumnIds = new Set(columnIds);
  return DEFAULT_TABLE_CONFIG[kind].grouping.filter((columnId) => allowedColumnIds.has(columnId));
}

function buildDefaultColumnOrder(kind: ManagementKind, columnIds: string[]) {
  const preferredColumnIds = DEFAULT_TABLE_CONFIG[kind].visibleColumnIds;
  const ordered = preferredColumnIds.filter((columnId) => columnIds.includes(columnId));
  return [...new Set(["select", ...ordered, ...columnIds])];
}

function buildDefaultColumnSizing(columnIds: string[]) {
  return Object.fromEntries(
    columnIds.map((columnId) => [columnId, DEFAULT_COLUMN_WIDTHS[columnId] || 140]),
  ) as ColumnSizingState;
}

function sanitizePreferences(
  kind: ManagementKind,
  rawValue: unknown,
  columnIds: string[],
  defaultVisibility: VisibilityState,
  defaultColumnSizing: ColumnSizingState,
): SavedPreferences {
  const fallback: SavedPreferences = {
    version: STORAGE_VERSION,
    columnVisibility: defaultVisibility,
    columnOrder: buildDefaultColumnOrder(kind, columnIds),
    columnSizing: defaultColumnSizing,
    sorting: buildDefaultSorting(kind, columnIds),
    grouping: buildDefaultGrouping(kind, columnIds),
  };

  if (!rawValue || typeof rawValue !== "object") {
    return fallback;
  }

  const saved = rawValue as Partial<SavedPreferences>;
  const allowedColumnIds = new Set(columnIds);
  const savedVisibilityEntries = Object.entries(saved.columnVisibility || {}).filter(([columnId]) =>
    allowedColumnIds.has(columnId),
  );
  const columnVisibility: VisibilityState = {
    ...defaultVisibility,
    ...Object.fromEntries(savedVisibilityEntries),
  };
  if (allowedColumnIds.has("select")) {
    columnVisibility.select = true;
  }
  if (allowedColumnIds.has("action")) {
    columnVisibility.action = true;
  }
  const columnOrder = [
    ...new Set([...(saved.columnOrder || []).filter((columnId) => allowedColumnIds.has(columnId)), ...columnIds]),
  ];
  const savedColumnSizing = saved.columnSizing || {};
  const columnSizing = Object.fromEntries(
    columnIds.map((columnId) => [
      columnId,
      normalizeColumnWidth(savedColumnSizing[columnId], defaultColumnSizing[columnId] || DEFAULT_COLUMN_WIDTHS[columnId] || 140),
    ]),
  ) as ColumnSizingState;
  const sorting = (saved.sorting || []).filter((item) => allowedColumnIds.has(item.id)).slice(0, 2);
  const grouping = (saved.grouping || []).filter((columnId) => allowedColumnIds.has(columnId)).slice(0, 2);

  return {
    version: STORAGE_VERSION,
    columnVisibility,
    columnOrder,
    columnSizing,
    sorting,
    grouping,
  };
}

function reorderColumns(columnOrder: ColumnOrderState, columnId: string, direction: "up" | "down") {
  const currentIndex = columnOrder.indexOf(columnId);
  if (currentIndex === -1) {
    return columnOrder;
  }

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= columnOrder.length) {
    return columnOrder;
  }

  const next = [...columnOrder];
  const [moved] = next.splice(currentIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

function buildGroupingValue(first: string, second: string) {
  return [first, second].filter(Boolean).slice(0, 2);
}

function buildSortingValue(
  firstColumn: string,
  firstDirection: "asc" | "desc",
  secondColumn: string,
  secondDirection: "asc" | "desc",
): SortingState {
  return [
    firstColumn ? { id: firstColumn, desc: firstDirection === "desc" } : null,
    secondColumn ? { id: secondColumn, desc: secondDirection === "desc" } : null,
  ].filter(Boolean) as SortingState;
}

function ManagementBulkActionBar({
  selectedCount,
  fields,
  field,
  value,
  pending,
  deleteLabel = "일괄 삭제",
  onFieldChange,
  onValueChange,
  onApply,
  onDelete,
  onClear,
}: {
  selectedCount: number;
  fields: BulkEditField[];
  field: string;
  value: string;
  pending: boolean;
  deleteLabel?: string;
  onFieldChange: (value: string) => void;
  onValueChange: (value: string) => void;
  onApply: () => void;
  onDelete?: () => void;
  onClear: () => void;
}) {
  if (selectedCount === 0 || fields.length === 0) {
    return null;
  }

  const selectedField = fields.find((item) => item.id === field) || fields[0];
  const valueOptions = selectedField.options || [];
  const canApply = value.trim().length > 0 && !pending;

  return (
    <div className="flex flex-col gap-3 border-b border-primary/20 bg-primary/5 px-3 py-3 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-end">
        <Badge variant="secondary" className="h-9 w-fit rounded-md px-3">
          선택 {selectedCount}건
        </Badge>
        <div className="grid min-w-[9rem] gap-1.5">
          <Label className="text-xs text-muted-foreground">수정 항목</Label>
          <Select value={selectedField.id} onValueChange={onFieldChange}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fields.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-[12rem] flex-1 gap-1.5">
          <Label className="text-xs text-muted-foreground">변경 값</Label>
          {valueOptions.length > 0 ? (
            <Select value={value || "__empty__"} onValueChange={(nextValue) => onValueChange(nextValue === "__empty__" ? "" : nextValue)}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder={selectedField.placeholder} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__empty__">선택 안 함</SelectItem>
                {valueOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              placeholder={selectedField.placeholder}
              className="h-9"
            />
          )}
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" className="h-9" disabled={!canApply} onClick={onApply}>
          <Pencil className="mr-2 size-4" />
          일괄 수정
        </Button>
        {onDelete ? (
          <Button type="button" size="sm" variant="destructive" className="h-9" disabled={pending} onClick={onDelete}>
            <Trash2 className="mr-2 size-4" />
            {deleteLabel}
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" className="h-9" disabled={pending} onClick={onClear}>
          선택 해제
        </Button>
      </div>
    </div>
  );
}

type ManagementDataTableProps = {
  kind: ManagementKind;
  rows: ManagementRow[];
  stats: ManagementStat[];
  loading: boolean;
  page: number;
  totalCount: number | null;
  sort: ManagementNumberedSort;
  displayedScope: string;
  onPageChange: (page: number) => void;
  onSortChange: (sort: ManagementNumberedSort) => void;
  filterOptions?: Record<string, unknown>;
  badgeLabel: string;
  statusLabel: string;
  emptyLabel: string;
  actions?: ManagementTableActions;
  pageSize: ManagementListPageSize;
  onPageSizePreferenceChange: (value: ManagementListPageSize) => void;
};

export function ManagementDataTable(props: ManagementDataTableProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Detail routes share this page, but do not change the list query or its state.
  const searchParamString = getManagementListQueryString(searchParams.toString());
  return <ManagementDataTableContent {...props} pathname={pathname} searchParamString={searchParamString} />;
}

const ManagementDataTableContent = memo(function ManagementDataTableContent({
  kind,
  rows,
  stats,
  loading,
  page,
  totalCount,
  sort,
  displayedScope,
  onPageChange,
  onSortChange,
  filterOptions = {},
  badgeLabel,
  statusLabel,
  emptyLabel,
  actions = {},
  pageSize,
  onPageSizePreferenceChange,
  pathname,
  searchParamString,
}: ManagementDataTableProps & { pathname: string; searchParamString: string }) {
  const router = useRouter();
  const tableLayoutRef = useRef<HTMLDivElement | null>(null);
  const tableViewportRef = useRef<HTMLDivElement | null>(null);
  const tablePagerRef = useRef<HTMLDivElement | null>(null);
  const managementScrollStorageKey = useMemo(
    () => getManagementListScrollStorageKey(kind, pathname, searchParamString),
    [kind, pathname, searchParamString],
  );
  const requestedClassListQueryState = useMemo(
    () => (kind === "classes" ? getClassListQueryState(new URLSearchParams(searchParamString)) : EMPTY_CLASS_LIST_QUERY_STATE),
    [kind, searchParamString],
  );
  const requestedStudentListQueryState = useMemo(
    () => (kind === "students" ? getStudentListQueryState(new URLSearchParams(searchParamString)) : EMPTY_STUDENT_LIST_QUERY_STATE),
    [kind, searchParamString],
  );
  const requestedTextbookListQueryState = useMemo(
    () => (kind === "textbooks" ? getTextbookListQueryState(new URLSearchParams(searchParamString)) : EMPTY_TEXTBOOK_LIST_QUERY_STATE),
    [kind, searchParamString],
  );
  const storageKey = managementTableStorageKey(kind);
  const sorting = useMemo(() => [...sort], [sort]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [rowSelection, setRowSelection] = useState({});
  const [globalFilter, setGlobalFilter] = useState(() => (
    kind === "classes"
      ? requestedClassListQueryState.q
      : kind === "students"
        ? requestedStudentListQueryState.q
        : requestedTextbookListQueryState.q
  ));
  const [searchComposing, setSearchComposing] = useState(false);
  const pendingSearchValueRef = useRef<string | null>(null);
  const deferredGlobalFilter = useDeferredValue(globalFilter);
  const debouncedGlobalFilter = useDebouncedValue(globalFilter, 300).trim();
  const [studentSchoolCategoryFilter, setStudentSchoolCategoryFilter] = useState(() => requestedStudentListQueryState.schoolCategory);
  const [studentSchoolFilter, setStudentSchoolFilter] = useState(() => requestedStudentListQueryState.school);
  const [studentGradeFilter, setStudentGradeFilter] = useState(() => requestedStudentListQueryState.grade);
  const pendingClassListQueryStateRef = useRef<ClassListQueryState | null>(null);
  const pendingStudentListQueryStateRef = useRef<StudentListQueryState | null>(null);
  const [grouping, setGrouping] = useState<GroupingState>([]);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const pageIndex = page - 1;
  const [tableViewportHeight, setTableViewportHeight] = useState<number>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [columnSearchQuery, setColumnSearchQuery] = useState("");
  const [hydratedStorageKey, setHydratedStorageKey] = useState("");
  const [bulkEditField, setBulkEditField] = useState(BULK_EDIT_FIELDS[kind][0]?.id || "");
  const [bulkEditValue, setBulkEditValue] = useState("");
  const [bulkActionPending, setBulkActionPending] = useState(false);
  const serverOptions = useCallback((key: string) => {
    const value = filterOptions[key];
    return Array.isArray(value) ? value.map(normalizeScalar).filter(Boolean) : [];
  }, [filterOptions]);
  const rememberManagementScrollPosition = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(
      managementScrollStorageKey,
      JSON.stringify({
        pageY: window.scrollY,
        tableX: tableViewportRef.current?.scrollLeft || 0,
        tableY: tableViewportRef.current?.scrollTop || 0,
      }),
    );
  }, [managementScrollStorageKey]);
  const openManagementRow = useCallback(
    (row: ManagementRow) => {
      rememberManagementScrollPosition();
      actions.onOpenRow?.(row);
    },
    [actions, rememberManagementScrollPosition],
  );

  const columns = useMemo<ColumnDef<ManagementRow>[]>(() => {
    const fixedColumns: ColumnDef<ManagementRow>[] = [
      {
        id: "select",
        header: ({ table }) => (
          <div className="flex items-center justify-center">
            <DataTableSelectionCheckbox
              checked={
                table.getIsAllPageRowsSelected() ||
                (table.getIsSomePageRowsSelected() && "indeterminate")
              }
              onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
              aria-label="현재 페이지 전체 선택"
            />
          </div>
        ),
        cell: ({ row }) => (
          <div className="flex items-center justify-center">
            <DataTableSelectionCheckbox
              checked={row.getIsSelected()}
              onCheckedChange={(value) => row.toggleSelected(!!value)}
              aria-label={`${emptyLabel} 항목 선택`}
            />
          </div>
        ),
        enableSorting: false,
        enableHiding: false,
        enableResizing: false,
        enableGrouping: false,
        size: 40,
        minSize: 40,
        maxSize: 40,
      },
      {
        id: "title",
        accessorFn: (row) => row.title,
        header: kind === "classes" ? "수업명" : "이름",
        cell: ({ row }) => (
          <div className="grid min-w-0 gap-0.5 py-0.5">
            <button
              type="button"
              className={cn(
                "-mx-1.5 inline-flex min-h-6 max-w-full cursor-pointer rounded-md px-1.5 py-0.5 text-left text-sm font-medium leading-5 underline-offset-4 transition-colors hover:bg-primary/5 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0",
                kind === "classes" ? "text-blue-600 dark:text-blue-400" : "text-foreground",
              )}
              onClick={() => openManagementRow(row.original)}
              data-student-detail-trigger={kind === "students" ? row.original.id : undefined}
              data-class-detail-trigger={kind === "classes" ? row.original.id : undefined}
            >
              <span className="min-w-0 whitespace-normal break-words">{row.original.title}</span>
            </button>
            {kind === "textbooks" ? (
              <span className="min-w-0 whitespace-normal break-words text-xs text-muted-foreground">{row.original.subtitle || "기본 정보 없음"}</span>
            ) : null}
          </div>
        ),
        filterFn: (row, _, value) => {
          const normalized = String(value || "").trim().toLowerCase();
          if (!normalized) {
            return true;
          }

          return row.original.searchText.toLowerCase().includes(normalized);
        },
      },
      {
        id: "subtitle",
        accessorFn: (row) => row.subtitle,
        header: "보조 정보",
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.subtitle || "-"}</span>,
      },
      {
        id: "school",
        accessorFn: (row) => normalizeScalar((row.raw || {}).school),
        header: "학교",
        cell: ({ row }) => renderPlainCell((row.original.raw || {}).school),
      },
      {
        id: "contact",
        accessorFn: (row) => normalizeScalar((row.raw || {}).contact),
        header: "연락처",
        cell: ({ row }) => renderPlainCell((row.original.raw || {}).contact),
      },
      {
        id: "parentContact",
        accessorFn: (row) => normalizeScalar((row.raw || {}).parent_contact || (row.raw || {}).parentContact),
        header: "학부모 연락처",
        cell: ({ row }) => renderPlainCell((row.original.raw || {}).parent_contact || (row.original.raw || {}).parentContact),
      },
      {
        id: "publisher",
        accessorFn: (row) => normalizeScalar((row.raw || {}).publisher || row.badge),
        header: "출판사",
        cell: ({ row }) => renderPlainCell((row.original.raw || {}).publisher || row.original.badge),
      },
      {
        id: "price",
        accessorFn: (row) => normalizeScalar((row.raw || {}).price),
        header: "가격",
        cell: ({ row }) => renderPlainCell(formatManagementCurrency((row.original.raw || {}).price)),
      },
      {
        id: "updatedAt",
        accessorFn: (row) => normalizeScalar((row.raw || {}).updated_at || (row.raw || {}).updatedAt),
        header: "수정일",
        cell: ({ row }) => renderPlainCell((row.original.raw || {}).updated_at || (row.original.raw || {}).updatedAt),
      },
      {
        id: "subject",
        accessorFn: (row) => normalizeScalar((row.raw || {}).subject || row.badge),
        header: "과목",
        cell: ({ row }) => renderPlainCell((row.original.raw || {}).subject || row.original.badge, "text-sm font-medium text-foreground"),
        filterFn: (row, columnId, value) => !value || row.getValue(columnId) === value,
      },
      {
        id: "grade",
        accessorFn: (row) => normalizeScalar((row.raw || {}).grade),
        header: "학년",
        cell: ({ row }) => renderPlainCell((row.original.raw || {}).grade, "text-sm text-foreground"),
        filterFn: (row, columnId, value) => !value || row.getValue(columnId) === value,
      },
      {
        id: "schedule",
        accessorFn: (row) => normalizeScalar((row.raw || {}).schedule),
        header: "요일/시간",
        cell: ({ row }) => renderClassScheduleCell(row.original),
      },
      {
        id: "teacher",
        accessorFn: (row) => normalizeScalar((row.raw || {}).teacher || (row.raw || {}).teacher_name || (row.raw || {}).teacherName),
        header: "선생님",
        cell: ({ row }) => renderClassResourceCell((row.original.raw || {}).teacher || (row.original.raw || {}).teacher_name || (row.original.raw || {}).teacherName),
        filterFn: (row, _, value) => !value || getClassFilterValues(row.original, "teacher").includes(String(value)),
      },
      {
        id: "classroom",
        accessorFn: (row) => normalizeScalar((row.raw || {}).classroom || (row.raw || {}).room),
        header: "강의실",
        cell: ({ row }) => renderClassResourceCell((row.original.raw || {}).classroom || (row.original.raw || {}).room),
        filterFn: (row, _, value) => !value || getClassFilterValues(row.original, "classroom").includes(String(value)),
      },
      {
        id: "enrollmentStatus",
        accessorFn: (row) => normalizeScalar((row.raw || {}).capacityStatus || (row.raw || {}).capacity_status),
        header: "수강 현황",
        cell: ({ row }) => (
          <ClassEnrollmentStatusCell
            key={getClassEnrollmentStatusCellKey(row.original)}
            row={row.original}
            onLoadRoster={actions.onLoadClassRoster}
          />
        ),
      },
      {
        id: "capacity",
        accessorFn: (row) => normalizeScalar((row.raw || {}).capacity),
        header: "정원",
        cell: ({ row }) => renderClassCapacityCell(row.original),
      },
      {
        id: "weeklyHours",
        accessorFn: (row) => normalizeScalar((row.raw || {}).weeklyHoursLabel || (row.raw || {}).weekly_hours_label || row.metrics.weeklyHoursLabel),
        header: "주간 수업시간",
        cell: ({ row }) => renderPlainCell((row.original.raw || {}).weeklyHoursLabel || (row.original.raw || {}).weekly_hours_label || row.original.metrics.weeklyHoursLabel),
      },
      {
        id: "tuition",
        accessorFn: (row) => normalizeScalar((row.raw || {}).tuitionLabel || (row.raw || {}).tuition_label || (row.raw || {}).fee || (row.raw || {}).tuition),
        header: "수업료",
        cell: ({ row }) => renderPlainCell((row.original.raw || {}).tuitionLabel || (row.original.raw || {}).tuition_label || formatManagementCurrency((row.original.raw || {}).fee || (row.original.raw || {}).tuition)),
      },
      {
        id: "action",
        accessorFn: () => "",
        header: "",
        enableSorting: false,
        enableHiding: false,
        enableResizing: false,
        enableGrouping: false,
        cell: ({ row }) => kind === "classes" ? null : kind === "students" ? (
          <div className="flex items-center justify-center">
            <StudentRowActions
              studentName={row.original.title}
              onWithdraw={actions.onDeleteRow ? () => actions.onDeleteRow?.(row.original) : undefined}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center">
            <Button
              variant="destructive-ghost"
              size="icon"
              className="size-6"
              aria-label={`${row.original.title} 삭제`}
              title="삭제"
              onClick={() => actions.onDeleteRow?.(row.original)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ),
      },
      {
        id: "badge",
        accessorFn: (row) => row.badge,
        header: badgeLabel,
        cell: ({ row }) => <Badge variant="secondary">{row.original.badge}</Badge>,
        filterFn: (row, columnId, value) => !value || row.getValue(columnId) === value,
      },
      {
        id: "status",
        accessorFn: (row) => (kind === "classes" ? getClassStatusFilterValue(row) : row.status),
        header: statusLabel,
        cell: ({ row }) =>
          kind === "students" ? (
            renderStudentClassStatusPopover(row.original)
          ) : (
            <Badge variant="secondary" className={getStatusColor(kind === "classes" ? getClassStatusFilterValue(row.original) : row.original.statusValue)}>
              {row.original.status}
            </Badge>
        ),
        filterFn: (row, columnId, value) => !value || row.getValue(columnId) === value,
        sortingFn: kind === "students"
          ? (rowA, rowB) => compareStudentStatusForTable(rowA.original.statusValue || rowA.original.status, rowB.original.statusValue || rowB.original.status)
          : undefined,
      },
      {
        id: "metaSummary",
        accessorFn: (row) => row.metaSummary,
        header: "상세",
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.metaSummary || "추가 정보 없음"}</span>,
      },
    ];

    return fixedColumns.filter((column) => {
      const columnId = String(column.id ?? "");
      return getKindColumnIds(kind).has(columnId) && USER_FACING_COLUMN_IDS.has(columnId);
    }).map((column) => ({ ...column, enableSorting: MANAGEMENT_NUMBERED_SORT_COLUMNS[kind].includes(String(column.id)) }));
  }, [actions, badgeLabel, emptyLabel, kind, openManagementRow, statusLabel]);

  const allColumnIds = useMemo(() => columns.map((column) => String(column.id ?? "")).filter(Boolean), [columns]);

  const defaultVisibility = useMemo(() => buildDefaultVisibility(kind, allColumnIds), [allColumnIds, kind]);
  const defaultColumnSizing = useMemo(() => buildDefaultColumnSizing(allColumnIds), [allColumnIds]);

  useEffect(() => {
    setBulkEditField(BULK_EDIT_FIELDS[kind][0]?.id || "");
    setBulkEditValue("");
    setBulkActionPending(false);
    setRowSelection({});
  }, [kind]);

  useEffect(() => {
    const fallback = sanitizePreferences(kind, null, allColumnIds, defaultVisibility, defaultColumnSizing);
    setHydratedStorageKey("");

    try {
      const rawSaved = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
      const parsed = rawSaved ? JSON.parse(rawSaved) : null;
      const sanitized = sanitizePreferences(kind, parsed, allColumnIds, defaultVisibility, defaultColumnSizing);
      setColumnVisibility(sanitized.columnVisibility);
      setColumnOrder(sanitized.columnOrder);
      setColumnSizing(sanitized.columnSizing);
      setGrouping(sanitized.grouping);
    } catch {
      setColumnVisibility(fallback.columnVisibility);
      setColumnOrder(fallback.columnOrder);
      setColumnSizing(fallback.columnSizing);
      setGrouping(fallback.grouping);

      if (typeof window !== "undefined") {
        window.localStorage.removeItem(storageKey);
      }
    }

    setHydratedStorageKey(storageKey);
  }, [allColumnIds, defaultColumnSizing, defaultVisibility, kind, storageKey]);

  useEffect(() => {
    if (typeof window === "undefined" || hydratedStorageKey !== storageKey || totalCount === null) {
      return;
    }

    const nextValue: SavedPreferences = {
      version: STORAGE_VERSION,
      columnVisibility,
      columnOrder,
      columnSizing,
      sorting,
      grouping,
    };

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(nextValue));
    } catch {
      // Ignore storage write failures and keep the current in-memory workspace state.
    }
  }, [columnOrder, columnSizing, columnVisibility, grouping, hydratedStorageKey, sorting, storageKey, totalCount]);

  const studentSchoolCategoryOptions = useMemo(
    () =>
      kind === "students"
        ? sortStudentSchoolCategories(serverOptions("schoolCategory"))
        : [],
    [kind, serverOptions],
  );
  const studentSchoolOptions = useMemo(() => {
    if (kind !== "students") {
      return [];
    }

    return serverOptions("school").sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
  }, [kind, serverOptions]);
  const studentGradeOptions = useMemo(() => {
    if (kind !== "students") {
      return [];
    }

    return sortStudentGradeOptions(serverOptions("grade"));
  }, [kind, serverOptions]);
  const tableSourceRows = rows;

  useEffect(() => {
    if (kind !== "students") {
      return;
    }

    if (studentSchoolFilter && !studentSchoolOptions.includes(studentSchoolFilter)) {
      setStudentSchoolFilter("");
    }
  }, [kind, studentSchoolFilter, studentSchoolOptions]);

  useEffect(() => {
    if (kind !== "students") {
      return;
    }

    if (studentGradeFilter && !studentGradeOptions.includes(studentGradeFilter)) {
      setStudentGradeFilter("");
    }
  }, [kind, studentGradeFilter, studentGradeOptions]);

  useEffect(() => {
    setRowSelection({});
    setBulkEditValue("");
  }, [displayedScope, page, pageSize]);

  const table = useReactTable({
    data: tableSourceRows,
    columns,
    onSortingChange: (updater) => {
      onSortChange(typeof updater === "function" ? updater(sorting) : updater);
      setRowSelection({});
      setBulkEditValue("");
    },
    onColumnFiltersChange: (updater) => {
      setColumnFilters(updater);
      setRowSelection({});
      setBulkEditValue("");
    },
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onColumnSizingChange: setColumnSizing,
    onRowSelectionChange: setRowSelection,
    onGroupingChange: (updater) => {
      setGrouping(updater);
      setExpanded({});
      setRowSelection({});
      setBulkEditValue("");
    },
    onExpandedChange: setExpanded,
    onPaginationChange: (updater) => {
      onPageChange((typeof updater === "function" ? updater({ pageIndex, pageSize }) : updater).pageIndex + 1);
    },
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      columnOrder,
      columnSizing,
      rowSelection,
      globalFilter: deferredGlobalFilter,
      grouping,
      expanded,
      pagination: { pageIndex, pageSize },
    },
    manualFiltering: true,
    manualPagination: true,
    manualSorting: true,
    rowCount: totalCount ?? 0,
    globalFilterFn: (row, _, value) => {
      const normalized = String(value || "").trim().toLowerCase();
      if (!normalized) {
        return true;
      }

      return row.original.searchText.toLowerCase().includes(normalized);
    },
    onGlobalFilterChange: setGlobalFilter,
    autoResetAll: false,
    defaultColumn: {
      minSize: 72,
      size: 140,
      maxSize: 420,
    },
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  useLayoutEffect(() => {
    const tableLayout = tableLayoutRef.current;
    const tablePager = tablePagerRef.current;
    const tableViewport = tableViewportRef.current;
    if (!tableLayout || !tablePager || !tableViewport) {
      return undefined;
    }

    const measureViewportHeight = () => {
      const pagerRect = tablePager.getBoundingClientRect();
      const viewportRect = tableViewport.getBoundingClientRect();
      const footerGap = Math.max(0, pagerRect.top - viewportRect.bottom);
      let bottomReserve = 0;
      for (let ancestor: HTMLElement | null = tableLayout; ancestor; ancestor = ancestor.parentElement) {
        const style = window.getComputedStyle(ancestor);
        bottomReserve += (Number.parseFloat(style.paddingBottom) || 0)
          + (Number.parseFloat(style.borderBottomWidth) || 0)
          + (Number.parseFloat(style.marginBottom) || 0);
        if (ancestor.dataset.slot === "sidebar-inset") break;
      }
      const nextViewportHeight = getManagementListViewportHeight({
        viewportHeight: window.innerHeight,
        viewportDocumentTop: viewportRect.top + window.scrollY,
        footerHeight: pagerRect.height || 44,
        footerGap,
        bottomReserve,
      });
      setTableViewportHeight((current) => current === nextViewportHeight ? current : nextViewportHeight);
    };

    const resizeObserver = new ResizeObserver(measureViewportHeight);
    resizeObserver.observe(tableLayout);
    resizeObserver.observe(tablePager);
    window.addEventListener("resize", measureViewportHeight, { passive: true });
    measureViewportHeight();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", measureViewportHeight);
    };
  }, [kind]);

  useEffect(() => {
    if (tableViewportRef.current) tableViewportRef.current.scrollTop = 0;
  }, [kind, pageIndex, pageSize, searchParamString, sorting, columnFilters, grouping]);

  const badgeOptions = useMemo(
    () =>
      serverOptions(kind === "textbooks" ? "publisher" : kind === "classes" ? "subject" : "grade")
        .sort((a, b) => a.localeCompare(b, "ko", { numeric: true })),
    [kind, serverOptions],
  );

  const statusOptions = useMemo(
    () =>
      kind === "classes"
        ? [...CLASS_STATUS_FILTER_OPTIONS]
        : kind === "students"
          ? [...STUDENT_STATUS_OPTIONS]
        : serverOptions("status").sort((a, b) => a.localeCompare(b, "ko")),
    [kind, serverOptions],
  );

  const subjectColumn =
    kind === "classes" && allColumnIds.includes("subject") ? table.getColumn("subject") : undefined;
  const selectedSubjectFilter = (subjectColumn?.getFilterValue() as string) || "";
  const selectedGradeFilter = kind === "classes" ? ((table.getColumn("grade")?.getFilterValue() as string) || "") : "";
  const selectedTeacherFilter = kind === "classes" ? ((table.getColumn("teacher")?.getFilterValue() as string) || "") : "";
  const selectedClassroomFilter = kind === "classes" ? ((table.getColumn("classroom")?.getFilterValue() as string) || "") : "";

  const classFilterOptions = useMemo(() => {
    const emptyOptions: Record<ClassFilterColumnId, string[]> = {
      subject: [],
      grade: [],
      teacher: [],
      classroom: [],
    };
    if (kind !== "classes") {
      return emptyOptions;
    }

    return CLASS_FILTERS.reduce<Record<ClassFilterColumnId, string[]>>((current, filter) => {
      const catalogOptions = filter.id === "teacher"
        ? getManagementTeacherCatalogOptions(tableSourceRows, selectedSubjectFilter)
        : [];
      current[filter.id] = sortClassFilterOptions(
        filter.id,
        [...new Set([...catalogOptions, ...serverOptions(filter.id)])],
      );
      return current;
    }, emptyOptions);
  }, [kind, serverOptions, tableSourceRows, selectedSubjectFilter]);

  const columnOptions = useMemo<ColumnOption[]>(
    () =>
      allColumnIds
        .filter((columnId) => USER_FACING_COLUMN_IDS.has(columnId))
        .filter((columnId) => columnId !== "select" && columnId !== "action")
        .map((columnId) => ({
          id: columnId,
          label: formatColumnLabel(columnId, badgeLabel, statusLabel, kind),
        })),
    [allColumnIds, badgeLabel, kind, statusLabel],
  );

  const badgeColumn = allColumnIds.includes("badge") ? table.getColumn("badge") : undefined;
  const statusColumn = allColumnIds.includes("status") ? table.getColumn("status") : undefined;
  const badgeFilter = (badgeColumn?.getFilterValue() as string) || "";
  const statusFilter = (statusColumn?.getFilterValue() as string) || "";
  const classFilterValues = kind === "classes"
    ? CLASS_FILTERS.map((filter) => ({
        ...filter,
        value: (table.getColumn(filter.id)?.getFilterValue() as string) || "",
      }))
    : CLASS_FILTERS.map((filter) => ({
        ...filter,
        value: "",
      }));
  const activeClassFilters = kind === "classes" ? classFilterValues.filter((filter) => filter.value) : [];
  const normalizedClassStatusFilter = kind === "classes" ? statusFilter || DEFAULT_CLASS_STATUS_FILTER : statusFilter;
  const hasNonDefaultStatusFilter = kind === "classes" && normalizedClassStatusFilter !== DEFAULT_CLASS_STATUS_FILTER;
  const hasActiveStudentFilters = kind === "students" && Boolean(statusFilter || studentSchoolCategoryFilter || studentSchoolFilter || studentGradeFilter);
  const normalizedGlobalFilter = String(globalFilter || "").trim();
  const normalizedColumnSearchQuery = columnSearchQuery.trim().toLowerCase();
  const hasActiveFilters = Boolean(
    normalizedGlobalFilter ||
      badgeFilter ||
      (kind === "classes" ? hasNonDefaultStatusFilter : statusFilter) ||
      activeClassFilters.length > 0 ||
      hasActiveStudentFilters,
  );
  const filteredRowCount = table.getFilteredRowModel().rows.length;
  const authoritativeTotal = totalCount?.toLocaleString("ko-KR");
  const summaryLabel = kind === "classes"
    ? authoritativeTotal === undefined ? "수업 건수 확인 중" : `전체 수업 ${authoritativeTotal}개 · 서버 집계`
    : `표시 ${filteredRowCount}건`;
  const selectedRowCount = table.getFilteredSelectedRowModel().rows.length;
  const selectedRows = table.getFilteredSelectedRowModel().rows.map((row) => row.original);
  const bulkEditFields = BULK_EDIT_FIELDS[kind];
  const selectedBulkEditField = bulkEditFields.find((item) => item.id === bulkEditField) || bulkEditFields[0];
  const visibleColumns = columnOptions.filter((option) => table.getColumn(option.id)?.getIsVisible()).length;
  const matchingColumnOrder = columnOrder.filter((columnId) => {
    if (columnId === "select") {
      return false;
    }

    const option = columnOptions.find((item) => item.id === columnId);
    if (!option) {
      return false;
    }

    if (!normalizedColumnSearchQuery) {
      return true;
    }

    return `${option.label} ${columnId}`.toLowerCase().includes(normalizedColumnSearchQuery);
  });
  const primaryGrouping = grouping[0] || "none";
  const secondaryGrouping = grouping[1] || "none";
  const primarySorting = sorting[0]?.id || "none";
  const secondarySorting = sorting[1]?.id || "none";
  const primarySortDirection = sorting[0]?.desc ? "desc" : "asc";
  const secondarySortDirection = sorting[1]?.desc ? "desc" : "asc";
  const captionSuffix = kind === "classes"
    ? summaryLabel
    : stats
      .filter((stat) => stat.value !== undefined && stat.value !== null)
      .slice(0, 2)
      .map((stat) => `${stat.label} ${stat.value}`)
      .join(" · ");
  const emptyStateTitle = rows.length === 0 ? `${emptyLabel} 없음` : `${emptyLabel} 결과 없음`;
  const createLabel = kind === "students" ? "학생 등록" : kind === "classes" ? "수업 등록" : "교재 등록";
  const hasCreateAction = typeof actions.onCreate === "function";
  const showSummaryBadge = hasActiveFilters || rows.length !== filteredRowCount;
  const showInitialLoading = shouldRenderManagementInitialLoading(loading, rows.length);
  useEffect(() => {
    if (typeof window === "undefined" || loading) {
      return undefined;
    }

    const savedScroll = parseStoredManagementScroll(window.sessionStorage.getItem(managementScrollStorageKey));
    if (!savedScroll) {
      return undefined;
    }

    const restoreScroll = () => {
      if (savedScroll.pageY > 0) {
        window.scrollTo({ top: savedScroll.pageY });
      }

      if (tableViewportRef.current && savedScroll.tableX > 0) {
        tableViewportRef.current.scrollLeft = savedScroll.tableX;
      }
      if (tableViewportRef.current && savedScroll.tableY > 0) {
        tableViewportRef.current.scrollTop = savedScroll.tableY;
      }
    };
    const firstFrame = window.requestAnimationFrame(() => {
      restoreScroll();
      window.requestAnimationFrame(restoreScroll);
    });

    return () => window.cancelAnimationFrame(firstFrame);
  }, [filteredRowCount, loading, managementScrollStorageKey, searchParamString]);
  const currentClassListQueryState = useMemo<ClassListQueryState>(
    () => ({
      q: debouncedGlobalFilter,
      status: normalizedClassStatusFilter,
      subject: selectedSubjectFilter,
      grade: selectedGradeFilter,
      teacher: selectedTeacherFilter,
      classroom: selectedClassroomFilter,
    }),
    [
      normalizedClassStatusFilter,
      debouncedGlobalFilter,
      selectedClassroomFilter,
      selectedGradeFilter,
      selectedSubjectFilter,
      selectedTeacherFilter,
    ],
  );
  const syncClassListQueryState = useCallback(
    (nextState: Partial<ClassListQueryState>, preserveLocalUntilUrl = false) => {
      if (kind !== "classes") {
        return;
      }

      const mergedState = { ...currentClassListQueryState, ...nextState };
      const liveQuery = window.location.search.slice(1);
      const nextHref = buildClassListHref(pathname, liveQuery, mergedState);
      const currentHref = liveQuery ? `${pathname}?${liveQuery}` : pathname;
      if (nextHref !== currentHref) {
        if (preserveLocalUntilUrl) {
          pendingClassListQueryStateRef.current = mergedState;
        }
        replaceManagementListUrl(window.history, nextHref);
      } else if (preserveLocalUntilUrl) {
        pendingClassListQueryStateRef.current = null;
      }
    },
    [currentClassListQueryState, kind, pathname],
  );
  const currentStudentListQueryState = useMemo<StudentListQueryState>(
    () => ({
      q: debouncedGlobalFilter,
      status: kind === "students" ? statusFilter : "",
      schoolCategory: studentSchoolCategoryFilter,
      school: studentSchoolFilter,
      grade: studentGradeFilter,
    }),
    [debouncedGlobalFilter, kind, statusFilter, studentGradeFilter, studentSchoolCategoryFilter, studentSchoolFilter],
  );
  const syncStudentListQueryState = useCallback(
    (nextState: Partial<StudentListQueryState>, preserveLocalUntilUrl = false) => {
      if (kind !== "students") {
        return;
      }

      const mergedState = { ...currentStudentListQueryState, ...nextState };
      const liveQuery = window.location.search.slice(1);
      const nextHref = buildStudentListHref(pathname, liveQuery, mergedState);
      const currentHref = liveQuery ? `${pathname}?${liveQuery}` : pathname;
      if (nextHref !== currentHref) {
        if (preserveLocalUntilUrl) {
          pendingStudentListQueryStateRef.current = mergedState;
        }
        replaceManagementListUrl(window.history, nextHref);
      } else if (preserveLocalUntilUrl) {
        pendingStudentListQueryStateRef.current = null;
      }
    },
    [currentStudentListQueryState, kind, pathname],
  );
  const currentTextbookListQueryState = useMemo<TextbookListQueryState>(() => ({
    q: debouncedGlobalFilter,
    status: kind === "textbooks" ? statusFilter : "",
    subject: requestedTextbookListQueryState.subject,
    publisher: kind === "textbooks" ? badgeFilter : "",
  }), [badgeFilter, debouncedGlobalFilter, kind, requestedTextbookListQueryState.subject, statusFilter]);
  const syncTextbookListQueryState = useCallback((nextState: Partial<TextbookListQueryState>) => {
    if (kind !== "textbooks") return;
    const liveQuery = window.location.search.slice(1);
    const nextHref = buildTextbookListHref(
      pathname,
      liveQuery,
      { ...currentTextbookListQueryState, ...nextState },
    );
    const currentHref = liveQuery ? `${pathname}?${liveQuery}` : pathname;
    if (nextHref !== currentHref) router.replace(nextHref, { scroll: false });
  }, [currentTextbookListQueryState, kind, pathname, router]);

  useEffect(() => {
    const requestedSearch = kind === "classes"
      ? requestedClassListQueryState.q
      : kind === "students"
        ? requestedStudentListQueryState.q
        : requestedTextbookListQueryState.q;
    const reconciliation = reconcilePendingManagementSearch({
      pendingSearch: pendingSearchValueRef.current,
      currentInput: globalFilter,
      debouncedInput: debouncedGlobalFilter,
      requestedSearch,
      composing: searchComposing,
    });
    pendingSearchValueRef.current = reconciliation.pendingSearch;
    if (!reconciliation.shouldSyncUrl) return;
    syncClassListQueryState({ q: debouncedGlobalFilter });
    syncStudentListQueryState({ q: debouncedGlobalFilter });
    syncTextbookListQueryState({ q: debouncedGlobalFilter });
  }, [
    debouncedGlobalFilter,
    globalFilter,
    kind,
    requestedClassListQueryState.q,
    requestedStudentListQueryState.q,
    requestedTextbookListQueryState.q,
    searchComposing,
    syncClassListQueryState,
    syncStudentListQueryState,
    syncTextbookListQueryState,
  ]);

  useEffect(() => {
    if (kind !== "classes") return;
    let active = true;
    // The parent router installs its history listener after child mount effects.
    queueMicrotask(() => {
      if (!active || window.location.pathname !== pathname) return;
      const params = new URLSearchParams(window.location.search);
      if (!params.has("period")) return;
      // Old bookmarks lose only their retired filter, preserving the current list and detail state.
      params.delete("period");
      const query = params.toString();
      replaceManagementListUrl(window.history, `${pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    });
    return () => { active = false; };
  }, [kind, pathname, searchParamString]);

  useEffect(() => {
    const requestedSearch = kind === "classes"
      ? requestedClassListQueryState.q
      : kind === "students"
        ? requestedStudentListQueryState.q
        : requestedTextbookListQueryState.q;
    const reconciliation = reconcilePendingManagementSearch({
      pendingSearch: pendingSearchValueRef.current,
      currentInput: globalFilter,
      debouncedInput: debouncedGlobalFilter,
      requestedSearch,
      composing: searchComposing,
    });
    pendingSearchValueRef.current = reconciliation.pendingSearch;
    if (reconciliation.pendingSearch === null && !searchComposing && globalFilter !== requestedSearch) {
      setGlobalFilter(requestedSearch);
    }
  }, [debouncedGlobalFilter, globalFilter, kind, requestedClassListQueryState.q, requestedStudentListQueryState.q, requestedTextbookListQueryState.q, searchComposing]);

  useEffect(() => {
    if (kind !== "classes" || !statusColumn) {
      return;
    }

    if (!CLASS_STATUS_FILTER_OPTIONS.includes(normalizedClassStatusFilter as (typeof CLASS_STATUS_FILTER_OPTIONS)[number])) {
      statusColumn.setFilterValue(DEFAULT_CLASS_STATUS_FILTER);
      return;
    }

    if (statusFilter !== normalizedClassStatusFilter) {
      statusColumn.setFilterValue(normalizedClassStatusFilter);
    }
  }, [kind, normalizedClassStatusFilter, statusColumn, statusFilter]);

  useEffect(() => {
    if (kind !== "classes") {
      return;
    }

    const reconciliation = reconcilePendingManagementFilters({
      current: currentClassListQueryState,
      requested: requestedClassListQueryState,
      pending: pendingClassListQueryStateRef.current,
    });
    pendingClassListQueryStateRef.current = reconciliation.pending;
    const nextFilters = reconciliation.filters;

    const requestedStatusFilter = nextFilters.status || DEFAULT_CLASS_STATUS_FILTER;
    if (statusColumn && statusFilter !== requestedStatusFilter) {
      statusColumn.setFilterValue(requestedStatusFilter);
    }

    for (const filter of CLASS_FILTERS) {
      const column = table.getColumn(filter.id);
      const requestedFilterValue = nextFilters[filter.id] || "";
      if (column && ((column.getFilterValue() as string) || "") !== requestedFilterValue) {
        column.setFilterValue(requestedFilterValue);
      }
    }
  }, [
    currentClassListQueryState,
    kind,
    requestedClassListQueryState,
    statusColumn,
    statusFilter,
    table,
  ]);

  useEffect(() => {
    if (kind !== "students") {
      return;
    }

    const reconciliation = reconcilePendingManagementFilters({
      current: currentStudentListQueryState,
      requested: requestedStudentListQueryState,
      pending: pendingStudentListQueryStateRef.current,
    });
    pendingStudentListQueryStateRef.current = reconciliation.pending;
    const nextFilters = reconciliation.filters;

    const requestedStatusFilter = nextFilters.status || "";
    if (statusColumn && statusFilter !== requestedStatusFilter) {
      statusColumn.setFilterValue(requestedStatusFilter);
    }

    if (studentSchoolCategoryFilter !== nextFilters.schoolCategory) {
      setStudentSchoolCategoryFilter(nextFilters.schoolCategory);
    }

    if (studentSchoolFilter !== nextFilters.school) {
      setStudentSchoolFilter(nextFilters.school);
    }

    if (studentGradeFilter !== nextFilters.grade) {
      setStudentGradeFilter(nextFilters.grade);
    }
  }, [
    currentStudentListQueryState,
    kind,
    requestedStudentListQueryState,
    statusColumn,
    statusFilter,
    studentGradeFilter,
    studentSchoolCategoryFilter,
    studentSchoolFilter,
  ]);

  useEffect(() => {
    if (kind !== "textbooks") return;
    if (badgeColumn && badgeFilter !== requestedTextbookListQueryState.publisher) {
      badgeColumn.setFilterValue(requestedTextbookListQueryState.publisher);
    }
    if (statusColumn && statusFilter !== requestedTextbookListQueryState.status) {
      statusColumn.setFilterValue(requestedTextbookListQueryState.status);
    }
  }, [badgeColumn, badgeFilter, kind, requestedTextbookListQueryState.publisher, requestedTextbookListQueryState.status, statusColumn, statusFilter]);

  const resetPreferences = () => {
    setColumnVisibility(defaultVisibility);
    setColumnOrder(buildDefaultColumnOrder(kind, allColumnIds));
    setColumnSizing(defaultColumnSizing);
    onSortChange(buildDefaultSorting(kind, allColumnIds));
    setGrouping(buildDefaultGrouping(kind, allColumnIds));
    setExpanded({});
    setColumnSearchQuery("");
    setRowSelection({});
    setBulkEditValue("");
  };

  const resetFilters = () => {
    pendingSearchValueRef.current = "";
    setGlobalFilter("");
    setStudentSchoolCategoryFilter("");
    setStudentSchoolFilter("");
    setStudentGradeFilter("");
    setRowSelection({});
    setExpanded({});
    setBulkEditValue("");
    badgeColumn?.setFilterValue("");
    if (kind === "classes") {
      statusColumn?.setFilterValue(DEFAULT_CLASS_STATUS_FILTER);
    } else {
      statusColumn?.setFilterValue("");
    }
    if (kind === "classes") {
      for (const filter of CLASS_FILTERS) {
        table.getColumn(filter.id)?.setFilterValue("");
      }
      syncClassListQueryState({
        q: "",
        status: DEFAULT_CLASS_STATUS_FILTER,
        subject: "",
        grade: "",
        teacher: "",
        classroom: "",
      });
    }
    if (kind === "students") {
      syncStudentListQueryState({
        q: "",
        status: "",
        schoolCategory: "",
        school: "",
        grade: "",
      }, true);
    }
    if (kind === "textbooks") {
      syncTextbookListQueryState({ q: "", status: "", subject: "", publisher: "" });
    }
  };

  const updateGlobalFilter = (value: string, options: { syncUrl?: boolean } = {}) => {
    if (options.syncUrl !== false) {
      pendingSearchValueRef.current = value.trim();
    }
    setGlobalFilter(value);
    setRowSelection({});
    setBulkEditValue("");
    if (options.syncUrl === false) return;
  };

  const isComposingSearchInput = (event: ChangeEvent<HTMLInputElement>) => (
    searchComposing ||
    ("isComposing" in event.nativeEvent && Boolean(event.nativeEvent.isComposing))
  );

  const handleGlobalFilterChange = (event: ChangeEvent<HTMLInputElement>) => {
    updateGlobalFilter(String(event.target.value), { syncUrl: !isComposingSearchInput(event) });
  };

  const handleGlobalFilterCompositionStart = () => {
    setSearchComposing(true);
  };

  const handleGlobalFilterCompositionEnd = (event: CompositionEvent<HTMLInputElement>) => {
    setSearchComposing(false);
    updateGlobalFilter(String(event.currentTarget.value), { syncUrl: true });
  };

  const updateGrouping = (nextGrouping: GroupingState) => {
    setGrouping(nextGrouping);
    setExpanded({});
    setRowSelection({});
    setBulkEditValue("");
  };

  const updateSorting = (nextSorting: SortingState) => {
    onSortChange(nextSorting);
    setRowSelection({});
    setBulkEditValue("");
  };

  const columnSettingsControl = (
    <DataTableSettings
      title={`${emptyLabel} 표 설정`}
      open={settingsOpen}
      onOpenChange={(open) => {
        setSettingsOpen(open);
        if (!open) setColumnSearchQuery("");
      }}
      onReset={resetPreferences}
    >
      <DataTableSettingsSection title="그룹화">
        <div className="grid gap-2">
          <div className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-2">
            <span className="text-xs text-muted-foreground">1단</span>
            <DataTableSettingsSelect
              label="1단 그룹" value={primaryGrouping}
              options={[{ id: "none", label: "없음" }, ...columnOptions]}
              onValueChange={(value) => updateGrouping(buildGroupingValue(value === "none" ? "" : value, secondaryGrouping === "none" ? "" : secondaryGrouping === value ? "" : secondaryGrouping))}
            />
          </div>
          <div className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-2">
            <span className="text-xs text-muted-foreground">2단</span>
            <DataTableSettingsSelect
              label="2단 그룹" value={secondaryGrouping}
              options={[{ id: "none", label: "없음" }, ...columnOptions.filter((option) => option.id !== primaryGrouping)]}
              onValueChange={(value) => updateGrouping(buildGroupingValue(primaryGrouping === "none" ? "" : primaryGrouping, value === "none" || value === primaryGrouping ? "" : value))}
            />
          </div>
        </div>
      </DataTableSettingsSection>
      <DataTableSettingsSection title="정렬">
        <div className="grid gap-2">
          <div className="grid grid-cols-[2rem_minmax(0,1fr)_6.5rem] items-center gap-2">
            <span className="text-xs text-muted-foreground">1차</span>
            <DataTableSettingsSelect
              label="1차 정렬 컬럼" value={primarySorting}
              options={[{ id: "none", label: "없음" }, ...columnOptions.filter((option) => MANAGEMENT_NUMBERED_SORT_COLUMNS[kind].includes(option.id))]}
              onValueChange={(value) => updateSorting(buildSortingValue(value === "none" ? "" : value, primarySortDirection as "asc" | "desc", secondarySorting === "none" ? "" : secondarySorting === value ? "" : secondarySorting, secondarySortDirection as "asc" | "desc"))}
            />
            <DataTableSettingsSelect
              label="1차 정렬 방향" value={primarySortDirection}
              options={[{ id: "asc", label: "오름차순" }, { id: "desc", label: "내림차순" }]}
              onValueChange={(value) => updateSorting(buildSortingValue(primarySorting === "none" ? "" : primarySorting, value as "asc" | "desc", secondarySorting === "none" ? "" : secondarySorting, secondarySortDirection as "asc" | "desc"))}
            />
          </div>
          <div className="grid grid-cols-[2rem_minmax(0,1fr)_6.5rem] items-center gap-2">
            <span className="text-xs text-muted-foreground">2차</span>
            <DataTableSettingsSelect
              label="2차 정렬 컬럼" value={secondarySorting}
              options={[{ id: "none", label: "없음" }, ...columnOptions.filter((option) => option.id !== primarySorting && MANAGEMENT_NUMBERED_SORT_COLUMNS[kind].includes(option.id))]}
              onValueChange={(value) => updateSorting(buildSortingValue(primarySorting === "none" ? "" : primarySorting, primarySortDirection as "asc" | "desc", value === "none" || value === primarySorting ? "" : value, secondarySortDirection as "asc" | "desc"))}
            />
            <DataTableSettingsSelect
              label="2차 정렬 방향" value={secondarySortDirection}
              options={[{ id: "asc", label: "오름차순" }, { id: "desc", label: "내림차순" }]}
              onValueChange={(value) => updateSorting(buildSortingValue(primarySorting === "none" ? "" : primarySorting, primarySortDirection as "asc" | "desc", secondarySorting === "none" ? "" : secondarySorting, value as "asc" | "desc"))}
            />
          </div>
        </div>
      </DataTableSettingsSection>
      <DataTableSettingsSection title="컬럼 구성" meta={<span className="text-xs tabular-nums text-muted-foreground">{visibleColumns} / {columnOptions.length} 표시</span>}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={columnSearchQuery} onChange={(event) => setColumnSearchQuery(event.target.value)}
            aria-label="컬럼 검색" placeholder="컬럼 검색" className="h-9 bg-muted/40 pl-9 pr-9 text-[13px] shadow-none max-sm:h-11"
          />
          {columnSearchQuery ? <Button type="button" variant="ghost" size="icon" className="absolute right-0.5 top-1/2 size-8 -translate-y-1/2" aria-label="컬럼 검색 지우기" onClick={() => setColumnSearchQuery("")}><X className="size-3.5" /></Button> : null}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_4.25rem_4.5rem] gap-2 px-1 text-[11px] text-muted-foreground" aria-hidden="true">
          <span>표시 · 이름</span><span className="text-center">너비 (px)</span><span className="text-center">순서</span>
        </div>
        {matchingColumnOrder.length === 0 ? (
          <p className="py-5 text-center text-sm text-muted-foreground" role="status">일치하는 컬럼이 없습니다.</p>
        ) : (
          <div className="-mt-1 divide-y divide-border/40">
            {matchingColumnOrder.map((columnId) => {
              const option = columnOptions.find((item) => item.id === columnId);
              const column = table.getColumn(columnId);
              const currentColumnIndex = columnOrder.indexOf(columnId);
              if (!option || !column || currentColumnIndex === -1) return null;
              const currentColumnWidth = column.getSize();
              return <DataTableColumnSetting key={columnId}
                label={option.label} visible={column.getIsVisible()} canHide={column.getCanHide()}
                width={currentColumnWidth} canMoveUp={currentColumnIndex !== 1} canMoveDown={currentColumnIndex !== columnOrder.length - 1}
                onVisibleChange={(value) => column.toggleVisibility(value)}
                onWidthChange={(value) => setColumnSizing((current) => ({ ...current, [columnId]: normalizeColumnWidth(value, currentColumnWidth) }))}
                onMove={(direction) => setColumnOrder((current) => reorderColumns(current, columnId, direction))}
              />;
            })}
          </div>
        )}
      </DataTableSettingsSection>
    </DataTableSettings>
  );

  const searchControl = (
    <div className="relative min-w-0" role="search" aria-label={`${emptyLabel} 검색`}>
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label={`${emptyLabel} 검색`}
        autoComplete="off"
        enterKeyHint="search"
        placeholder={`${emptyLabel} 검색`}
        value={globalFilter ?? ""}
        onChange={handleGlobalFilterChange}
        onCompositionStart={handleGlobalFilterCompositionStart}
        onCompositionEnd={handleGlobalFilterCompositionEnd}
        className="h-9 pl-9 pr-9"
      />
      {normalizedGlobalFilter ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 size-7 -translate-y-1/2 rounded-md active:-translate-y-1/2"
          onClick={() => updateGlobalFilter("")}
          aria-label={`${emptyLabel} 검색어 지우기`}
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );

  const createControl = (
    <Button
      variant={hasCreateAction ? "default" : "outline"}
      size="sm"
      className="h-9 shrink-0"
      onClick={actions.onCreate}
      disabled={!hasCreateAction}
    >
      <Plus className="mr-2 size-4" />
      {createLabel}
    </Button>
  );

  const resetControl = hasActiveFilters ? (
    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={resetFilters}>
      <X className="mr-1.5 size-3.5" />
      조건 초기화
    </Button>
  ) : null;

  const classFilterSelects: ClassFilterPanelSelect[] =
    kind === "classes"
      ? [
          {
            id: "status",
            label: statusLabel,
            value: normalizedClassStatusFilter,
            options: statusOptions.map((option) => ({
              value: option,
              label: option,
            })),
            onChange: (value) => {
              statusColumn?.setFilterValue(value);
              syncClassListQueryState({ status: value }, true);
              setRowSelection({});
            },
          },
          ...CLASS_FILTERS.map((filter) => {
            const column = table.getColumn(filter.id);
            const currentValue = (column?.getFilterValue() as string) || "";
            return {
              id: `class-${filter.id}`,
              label: filter.label,
              value: currentValue || "all",
              allowEmpty: true,
              emptyValue: "all",
              emptyLabel: `전체 ${filter.label}`,
              options: classFilterOptions[filter.id].map((option) => ({
                value: option,
                label: option,
              })),
              onChange: (value: string) => {
                const nextFilterValue = value === "all" ? "" : value;
                column?.setFilterValue(nextFilterValue);
                if (filter.id === "subject") {
                  table.getColumn("teacher")?.setFilterValue("");
                  table.getColumn("classroom")?.setFilterValue("");
                  syncClassListQueryState({ [filter.id]: nextFilterValue, teacher: "", classroom: "" }, true);
                } else {
                  syncClassListQueryState({ [filter.id]: nextFilterValue }, true);
                }
                setRowSelection({});
              },
            };
          }),
        ]
      : [];

  const renderStudentStatusSelect = () => (
    <div className="min-w-0">
      <Label htmlFor="student-status-filter" className="sr-only">
        재원 상태
      </Label>
      <Select
        value={statusFilter || "all"}
        onValueChange={(value) => {
          const nextStatusValue = value === "all" ? "" : value;
          statusColumn?.setFilterValue(nextStatusValue);
          syncStudentListQueryState({ status: nextStatusValue }, true);
          setRowSelection({});
        }}
      >
        <SelectTrigger className="h-9 w-full" id="student-status-filter" aria-label="재원 상태">
          <SelectValue placeholder="재원 상태" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">전체 상태</SelectItem>
          {STUDENT_STATUS_OPTIONS.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const renderStudentSchoolCategorySelect = () => (
    <div className="min-w-0">
      <Label htmlFor="student-school-category-filter" className="sr-only">
        학교 구분
      </Label>
      <Select
        value={studentSchoolCategoryFilter || "all"}
        onValueChange={(value) => {
          const nextSchoolCategoryFilter = value === "all" ? "" : value;
          setStudentSchoolCategoryFilter(nextSchoolCategoryFilter);
          setStudentSchoolFilter("");
          setStudentGradeFilter("");
          syncStudentListQueryState({ schoolCategory: nextSchoolCategoryFilter, school: "", grade: "" }, true);
          setRowSelection({});
        }}
      >
        <SelectTrigger className="h-9 w-full" id="student-school-category-filter" aria-label="학교 구분">
          <SelectValue placeholder="학교 구분" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">전체 학교 구분</SelectItem>
          {studentSchoolCategoryOptions.map((option) => (
            <SelectItem key={option} value={option}>
              {formatStudentSchoolCategoryLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const renderStudentSchoolSelect = () => (
    <div className="min-w-0">
      <Label htmlFor="student-school-filter" className="sr-only">
        학교
      </Label>
      <Select
        value={studentSchoolFilter || "all"}
        onValueChange={(value) => {
          const nextSchoolFilter = value === "all" ? "" : value;
          setStudentSchoolFilter(nextSchoolFilter);
          setStudentGradeFilter("");
          syncStudentListQueryState({ school: nextSchoolFilter, grade: "" }, true);
          setRowSelection({});
        }}
      >
        <SelectTrigger className="h-9 w-full" id="student-school-filter" aria-label="학교">
          <SelectValue placeholder="학교" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">전체 학교</SelectItem>
          {studentSchoolOptions.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const renderStudentGradeSelect = () => (
    <div className="min-w-0">
      <Label htmlFor="student-grade-filter" className="sr-only">
        학년
      </Label>
      <Select
        value={studentGradeFilter || "all"}
        onValueChange={(value) => {
          const nextGradeFilter = value === "all" ? "" : value;
          setStudentGradeFilter(nextGradeFilter);
          syncStudentListQueryState({ grade: nextGradeFilter }, true);
          setRowSelection({});
        }}
      >
        <SelectTrigger className="h-9 w-full" id="student-grade-filter" aria-label="학년">
          <SelectValue placeholder="학년" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">전체 학년</SelectItem>
          {studentGradeOptions.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const renderStudentQuickFilter = (label: string, select: ReactNode, className?: string) => (
    <div className={cn(DATA_TABLE_FILTER_FIELD_CLASS_NAME, className)}>
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {select}
    </div>
  );

  async function submitBulkUpdate() {
    if (!selectedRows.length || !selectedBulkEditField || !bulkEditValue.trim() || !actions.onBulkUpdateRows) {
      return;
    }

    setBulkActionPending(true);
    try {
      await actions.onBulkUpdateRows(selectedRows, {
        field: selectedBulkEditField.id,
        value: bulkEditValue.trim(),
      });
      setBulkEditValue("");
      setRowSelection({});
    } finally {
      setBulkActionPending(false);
    }
  }

  async function submitBulkDelete() {
    if (!selectedRows.length || !actions.onBulkDeleteRows) {
      return;
    }

    setBulkActionPending(true);
    try {
      await actions.onBulkDeleteRows(selectedRows);
      setRowSelection({});
    } finally {
      setBulkActionPending(false);
    }
  }

  const bulkActionBar = (
    <ManagementBulkActionBar
      selectedCount={selectedRows.length}
      fields={bulkEditFields}
      field={bulkEditField}
      value={bulkEditValue}
      pending={bulkActionPending}
      deleteLabel={kind === "students" ? "일괄 퇴원" : "일괄 삭제"}
      onFieldChange={(nextField) => {
        setBulkEditField(nextField);
        setBulkEditValue("");
      }}
      onValueChange={setBulkEditValue}
      onApply={() => void submitBulkUpdate()}
      onDelete={actions.onBulkDeleteRows ? () => void submitBulkDelete() : undefined}
      onClear={() => setRowSelection({})}
    />
  );

  const classMobileList = kind === "classes" ? (
    <div className={DATA_TABLE_MOBILE_LIST_CLASS_NAME} aria-label={`${emptyLabel} 모바일 목록`}>
      {showInitialLoading ? (
        Array.from({ length: 5 }).map((_, index) => (
          <div key={`class-mobile-loading-${index}`} className="rounded-lg border border-border/70 bg-background p-3">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="mt-3 h-4 w-64" />
            <Skeleton className="mt-3 h-16 w-full" />
          </div>
        ))
      ) : table.getRowModel().rows.length ? (
        table.getRowModel().rows.map((row) => {
          const record = row.original;
          const raw = record.raw || {};
          const subject = normalizeScalar(raw.subject || record.badge);
          const grade = normalizeScalar(raw.grade);
          const teacher = formatDelimitedLabel(raw.teacher || raw.teacher_name || raw.teacherName);
          const classroom = formatDelimitedLabel(raw.classroom || raw.room);
          const capacity = getClassCapacity(record);
          const weeklyHours = normalizeScalar(raw.weeklyHoursLabel || raw.weekly_hours_label || record.metrics.weeklyHoursLabel);
          const tuition = normalizeScalar(raw.tuitionLabel || raw.tuition_label) || formatManagementCurrency(raw.fee || raw.tuition);

          return (
            <article key={`class-mobile-${row.id}`} className="rounded-lg border border-border/70 bg-background p-3">
              <div className="flex items-start gap-3">
                <DataTableSelectionCheckbox
                  checked={row.getIsSelected()}
                  onCheckedChange={(value) => row.toggleSelected(!!value)}
                  aria-label={`${record.title} 선택`}
                  className="-ml-2 -mt-1"
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    {subject ? <Badge className="rounded-md px-2 py-0.5">{subject}</Badge> : null}
                    {grade ? <Badge variant="secondary" className="rounded-md px-2 py-0.5">{grade}</Badge> : null}
                    <Badge variant="secondary" className={cn("rounded-md px-2 py-0.5", getStatusColor(getClassStatusFilterValue(record)))}>
                      {record.status}
                    </Badge>
                  </div>
                  <button
                    type="button"
                    className="block min-w-0 text-left text-base font-semibold leading-6 text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() => openManagementRow(record)}
                    data-class-detail-trigger={record.id}
                  >
                    {record.title}
                  </button>
                  <div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-sm text-muted-foreground">
                    {teacher ? <span className="min-w-0 break-keep">{teacher}</span> : null}
                    {classroom ? <span className="min-w-0 break-keep">{classroom}</span> : null}
                  </div>
                </div>
              </div>
              <dl className="mt-3 grid gap-2 border-t border-border/70 pt-3 text-sm">
                <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3">
                  <dt className="text-muted-foreground">요일/시간</dt>
                  <dd className="min-w-0 text-foreground [&>div]:min-w-0 [&_span]:break-keep">
                    {renderClassScheduleCell(row.original)}
                  </dd>
                </div>
                <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3">
                  <dt className="text-muted-foreground">수강</dt>
                  <dd className="min-w-0 [&>div]:min-w-0">
                    <ClassEnrollmentStatusCell
                      key={getClassEnrollmentStatusCellKey(record)}
                      row={record}
                      onLoadRoster={actions.onLoadClassRoster}
                    />
                  </dd>
                </div>
                <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3">
                  <dt className="text-muted-foreground">운영</dt>
                  <dd className="min-w-0 break-keep text-foreground">
                    {[capacity > 0 ? `정원 ${capacity}` : "", weeklyHours, tuition].filter(Boolean).join(" · ") || "-"}
                  </dd>
                </div>
              </dl>
            </article>
          );
        })
      ) : (
        <div className="rounded-lg border border-border/70 bg-background px-3 py-8 text-center">
          <span className="text-sm font-medium text-muted-foreground">{emptyStateTitle}</span>
          {hasActiveFilters ? (
            <div className="mt-3">
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={resetFilters}>
                조건 초기화
              </Button>
            </div>
          ) : hasCreateAction ? (
            <div className="mt-3">
              <Button type="button" size="sm" className="h-8" onClick={actions.onCreate}>
                <Plus className="mr-1.5 size-3.5" />
                {createLabel}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  ) : null;

  const studentMobileList = kind === "students" ? (
    <div className={DATA_TABLE_MOBILE_LIST_CLASS_NAME} aria-label={`${emptyLabel} 모바일 학생 목록`}>
      {showInitialLoading ? (
        Array.from({ length: 5 }).map((_, index) => (
          <div key={`student-mobile-loading-${index}`} className="rounded-lg border border-border/70 bg-background p-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-3 h-4 w-48" />
            <Skeleton className="mt-3 h-16 w-full" />
          </div>
        ))
      ) : table.getRowModel().rows.length ? (
        table.getRowModel().rows.map((row) => {
          const record = row.original;
          const raw = record.raw || {};
          const school = normalizeScalar(raw.school);
          const grade = normalizeScalar(raw.grade);
          const contact = normalizeScalar(raw.contact);
          const parentContact = normalizeScalar(raw.parent_contact || raw.parentContact);

          return (
            <article
              key={`student-mobile-${row.id}`}
              data-testid={`student-mobile-card-${row.id}`}
              className="rounded-lg border border-border/70 bg-background p-3"
            >
              <div className="flex items-start gap-3">
                <DataTableSelectionCheckbox
                  checked={row.getIsSelected()}
                  onCheckedChange={(value) => row.toggleSelected(!!value)}
                  aria-label={`${record.title} 선택`}
                  className="-ml-2 -mt-1"
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    {renderStudentClassStatusPopover(record)}
                    {school ? <Badge variant="secondary" className="rounded-md px-2 py-0.5">{school}</Badge> : null}
                    {grade ? <Badge variant="outline" className="rounded-md px-2 py-0.5">{grade}</Badge> : null}
                  </div>
                  <button
                    type="button"
                    className="block min-w-0 text-left text-base font-semibold leading-6 text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() => openManagementRow(record)}
                    data-student-detail-trigger={record.id}
                  >
                    {record.title}
                  </button>
                </div>
                <StudentRowActions
                  studentName={record.title}
                  onWithdraw={actions.onDeleteRow ? () => actions.onDeleteRow?.(record) : undefined}
                />
              </div>

              <dl className="mt-3 grid gap-2 border-t border-border/70 pt-3 text-sm">
                <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                  <dt className="text-muted-foreground">학생 연락처</dt>
                  <dd className="min-w-0 break-keep text-foreground">{contact || "-"}</dd>
                </div>
                <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                  <dt className="text-muted-foreground">학부모</dt>
                  <dd className="min-w-0 break-keep text-foreground">{parentContact || "-"}</dd>
                </div>
              </dl>
            </article>
          );
        })
      ) : (
        <div className="rounded-lg border border-border/70 bg-background px-3 py-8 text-center">
          <span className="text-sm font-medium text-muted-foreground">{emptyStateTitle}</span>
          {hasActiveFilters ? (
            <div className="mt-3">
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={resetFilters}>
                조건 초기화
              </Button>
            </div>
          ) : hasCreateAction ? (
            <div className="mt-3">
              <Button type="button" size="sm" className="h-8" onClick={actions.onCreate}>
                <Plus className="mr-1.5 size-3.5" />
                {createLabel}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div ref={tableLayoutRef} className={DATA_TABLE_LAYOUT_CLASS_NAME}>
      {kind === "classes" ? (
        <ClassFilterPanel
          className={DATA_TABLE_TOOLBAR_CLASS_NAME}
          selects={classFilterSelects}
          searchValue={String(globalFilter || "")}
          searchPlaceholder={`${emptyLabel} 검색`}
          onSearchChange={updateGlobalFilter}
          onSearchCompositionStart={handleGlobalFilterCompositionStart}
          onSearchCompositionEnd={(value) => {
            setSearchComposing(false);
            updateGlobalFilter(value, { syncUrl: true });
          }}
          summaryLabel={""}
          showReset={hasActiveFilters}
          onReset={resetFilters}
          createLabel={createLabel}
          onCreate={actions.onCreate}
          createDisabled={!hasCreateAction}
          footerAction={null}
          toolbarAction={<div className="ml-auto flex justify-end">{columnSettingsControl}</div>}
        />
      ) : (
        <DataTableToolbar className={cn("gap-2", kind === "students" && "student-list-toolbar")}>
          <div className="flex flex-wrap items-center gap-2">
            {kind === "students" ? (
              <>
                <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">{searchControl}</div>
                {createControl}
                <div className="ml-auto flex justify-end">{columnSettingsControl}</div>
              </>
            ) : (
              <>
                <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">{searchControl}</div>
                {badgeColumn ? (
                  <div className="min-w-0 flex-1 sm:w-40 sm:flex-none">
                    <Label htmlFor="badge-filter" className="sr-only">
                      {badgeLabel}
                    </Label>
                    <Select
                      value={badgeFilter || "all"}
                      onValueChange={(value) => {
                        const nextValue = value === "all" ? "" : value;
                        badgeColumn.setFilterValue(nextValue);
                        syncTextbookListQueryState({ publisher: nextValue });
                        setRowSelection({});
                      }}
                    >
                      <SelectTrigger className="h-9 w-full" id="badge-filter" aria-label={badgeLabel}>
                        <SelectValue placeholder={badgeLabel} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">전체 {badgeLabel}</SelectItem>
                        {badgeOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="min-w-0 flex-1 sm:w-32 sm:flex-none">
                  <Label htmlFor="status-filter" className="sr-only">
                    {statusLabel}
                  </Label>
                  <Select
                    value={statusFilter || "all"}
                    onValueChange={(value) => {
                      const nextValue = value === "all" ? "" : value;
                      statusColumn?.setFilterValue(nextValue);
                      syncTextbookListQueryState({ status: nextValue });
                      setRowSelection({});
                    }}
                  >
                    <SelectTrigger className="h-9 w-full" id="status-filter" aria-label={statusLabel}>
                      <SelectValue placeholder={statusLabel} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체 {statusLabel}</SelectItem>
                      {statusOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {createControl}
                <div className="ml-auto flex justify-end">{columnSettingsControl}</div>
              </>
            )}
          </div>

          {kind === "students" ? (
            <DataTableFilters data-testid="student-quick-filters" aria-label="학생 검색 조건">
              {renderStudentQuickFilter("재원 상태", renderStudentStatusSelect())}
              {renderStudentQuickFilter("학교 구분", renderStudentSchoolCategorySelect())}
              {renderStudentQuickFilter("학교", renderStudentSchoolSelect(), "sm:w-52")}
              {renderStudentQuickFilter("학년", renderStudentGradeSelect())}
              {hasActiveFilters ? <div className="flex h-9 items-center sm:ml-auto">{resetControl}</div> : null}
            </DataTableFilters>
          ) : null}

          <div className={cn("flex flex-wrap items-center gap-2 text-xs text-muted-foreground", kind === "students" && "student-filter-status")} aria-live="polite">
            {showSummaryBadge ? <Badge variant="secondary">{summaryLabel}</Badge> : null}
            {rows.length !== filteredRowCount ? <Badge variant="outline">전체 {rows.length}건</Badge> : null}
            {selectedRowCount > 0 ? <Badge variant="outline">선택 {selectedRowCount}건</Badge> : null}
            {grouping.length > 0 ? <Badge variant="outline">그룹 {grouping.length}단</Badge> : null}
            {kind !== "students" ? (
              <>
                {normalizedGlobalFilter ? <Badge variant="outline">검색어 {normalizedGlobalFilter}</Badge> : null}
                {badgeFilter ? <Badge variant="outline">{badgeLabel} {badgeFilter}</Badge> : null}
                {statusFilter ? <Badge variant="outline">{statusLabel} {statusFilter}</Badge> : null}
                {resetControl}
              </>
            ) : null}
          </div>
        </DataTableToolbar>
      )}

      {bulkActionBar}

      {studentMobileList}
      {classMobileList}

      <DataTableViewport
        ref={tableViewportRef}
        data-testid="management-table-viewport"
        role="region"
        aria-label={`${emptyLabel} 목록 스크롤`}
        tabIndex={0}
        className={cn(
          "md:max-h-[var(--management-table-height)] [&>[data-slot=table-container]]:overflow-visible",
          (kind === "classes" || kind === "students") && "hidden md:block",
        )}
        style={{ "--management-table-height": tableViewportHeight ? `${tableViewportHeight}px` : undefined } as CSSProperties}
        aria-busy={loading}
      >
        <Table className={DATA_TABLE_TABLE_CLASS_NAME}>
          <caption className="sr-only">{emptyLabel} 운영 목록{captionSuffix ? ` · ${captionSuffix}` : ""}</caption>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <DataTableHeaderRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sortState = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  const columnLabel = formatColumnLabel(header.id, badgeLabel, statusLabel, kind);
                  return (
                    <DataTableHeaderCell
                      key={header.id}
                      aria-sort={sortState === "asc" ? "ascending" : sortState === "desc" ? "descending" : undefined}
                      className={cn(
                        header.id === "select" || header.id === "action" ? "text-center" : "",
                        header.id === "select" && "px-0 py-0",
                        !getPinnedColumn(header.id, "header") && "z-20",
                      )}
                      pin={getPinnedColumn(header.id, "header")}
                      style={getColumnSizeStyle(header.getSize())}
                    >
                      {header.isPlaceholder ? null : (
                        <>
                          <div className={cn(header.id === "select" || header.id === "action" ? "flex items-center justify-center" : "pr-3")}>
                            {header.id === "action" ? (
                              <span className="sr-only">작업</span>
                            ) : canSort ? (
                              <DataTableSortButton
                                direction={sortState}
                                label={columnLabel}
                                onClick={() => {
                                  setRowSelection({});
                                  setBulkEditValue("");
                                  header.column.toggleSorting(sortState === "asc");
                                }}
                              >
                                {flexRender(header.column.columnDef.header, header.getContext())}
                              </DataTableSortButton>
                            ) : (
                              flexRender(header.column.columnDef.header, header.getContext())
                            )}
                          </div>
                          {header.column.getCanResize() ? (
                            <button
                              type="button"
                              aria-label={`${columnLabel} 열 너비 조절`}
                              title={`${columnLabel} 열 너비 조절`}
                              className={cn(
                                "absolute right-0 top-0 h-full w-6 cursor-col-resize transition-colors after:absolute after:right-0 after:top-0 after:h-full after:w-px after:bg-transparent after:content-[''] hover:bg-accent/30 hover:after:bg-border focus-visible:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:after:bg-primary motion-reduce:transition-none",
                                header.column.getIsResizing() ? "bg-primary/15 after:bg-primary" : "",
                              )}
                              onMouseDown={header.getResizeHandler()}
                              onTouchStart={header.getResizeHandler()}
                              onDoubleClick={() => header.column.resetSize()}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  header.column.resetSize();
                                }
                              }}
                            />
                          ) : null}
                        </>
                      )}
                    </DataTableHeaderCell>
                  );
                })}
              </DataTableHeaderRow>
            ))}
          </TableHeader>
          <TableBody>
            {showInitialLoading ? (
              <>
                <DataTableBodyRow>
                  <DataTableBodyCell
                    colSpan={table.getVisibleLeafColumns().length || columns.length}
                    className="text-sm text-muted-foreground"
                    role="status"
                    aria-live="polite"
                  >
                    {emptyLabel} 데이터를 불러오는 중입니다.
                  </DataTableBodyCell>
                </DataTableBodyRow>
                {Array.from({ length: 5 }).map((_, index) => (
                  <DataTableBodyRow key={`loading-${index}`}>
                    <DataTableBodyCell colSpan={table.getVisibleLeafColumns().length || columns.length}>
                      <Skeleton className="h-6 w-full" />
                    </DataTableBodyCell>
                  </DataTableBodyRow>
                ))}
              </>
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <DataTableBodyRow
                  key={row.id}
                  data-management-row="true"
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => {
                    if (cell.getIsGrouped()) {
                      return (
                        <DataTableBodyCell
                          key={cell.id}
                          pin={getPinnedColumn(cell.column.id, "body")}
                          wrap
                          style={getColumnSizeStyle(cell.column.getSize())}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto min-h-6 w-full items-start justify-start gap-1.5 px-0 py-0 text-left font-normal"
                            onClick={row.getToggleExpandedHandler()}
                          >
                            {row.getIsExpanded() ? <ChevronDown className="mt-0.5 size-4 shrink-0" /> : <ChevronRight className="mt-0.5 size-4 shrink-0" />}
                            <span className="min-w-0 whitespace-normal break-words leading-5">
                              {String(cell.getValue() || "값 없음")}
                              <Badge variant="secondary" className="ml-1.5 align-middle">{row.subRows.length}건</Badge>
                            </span>
                          </Button>
                        </DataTableBodyCell>
                      );
                    }

                    if (cell.getIsPlaceholder()) {
                      return (
                        <DataTableBodyCell
                          key={cell.id}
                          pin={getPinnedColumn(cell.column.id, "body")}
                          wrap
                          style={getColumnSizeStyle(cell.column.getSize())}
                        />
                      );
                    }

                    if (cell.getIsAggregated()) {
                      return (
                        <DataTableBodyCell
                          key={cell.id}
                          pin={getPinnedColumn(cell.column.id, "body")}
                          wrap
                          style={getColumnSizeStyle(cell.column.getSize())}
                        />
                      );
                    }

                    return (
                      <DataTableBodyCell
                        key={cell.id}
                        pin={getPinnedColumn(cell.column.id, "body")}
                        wrap
                        className={cell.column.id === "select" ? "px-0 py-1" : undefined}
                        style={getColumnSizeStyle(cell.column.getSize())}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </DataTableBodyCell>
                    );
                  })}
                </DataTableBodyRow>
              ))
            ) : (
              <DataTableBodyRow>
                <DataTableBodyCell colSpan={table.getVisibleLeafColumns().length || columns.length} className="h-28 py-6">
                  <div className="mx-auto flex max-w-xl flex-wrap items-center justify-center gap-2 text-center">
                    <span className="text-sm font-medium text-muted-foreground">{emptyStateTitle}</span>
                    {hasActiveFilters ? (
                      <Button type="button" variant="outline" size="sm" className="h-8" onClick={resetFilters}>
                        조건 초기화
                      </Button>
                    ) : hasCreateAction ? (
                      <Button type="button" size="sm" className="h-8" onClick={actions.onCreate}>
                        <Plus className="mr-1.5 size-3.5" />
                        {createLabel}
                      </Button>
                    ) : null}
                  </div>
                </DataTableBodyCell>
              </DataTableBodyRow>
            )}
          </TableBody>
        </Table>
      </DataTableViewport>

      <div ref={tablePagerRef} className={DATA_TABLE_PAGER_CLASS_NAME}>
        <div className="w-full">
          <DataTablePagination
            page={page}
            pageSize={pageSize}
            totalCount={totalCount}
            loading={loading}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizePreferenceChange}
            ariaLabel={`${emptyLabel} 목록 페이지 탐색`}
          />
        </div>
      </div>
    </div>
  );
});
