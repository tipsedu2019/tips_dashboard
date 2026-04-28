"use client";

import { useEffect, useMemo, useState } from "react";
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
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ManagementKind, ManagementRow, ManagementStat } from "@/features/management/use-management-records";
import {
  ClassFilterPanel,
  type ClassFilterPanelChip,
  type ClassFilterPanelSelect,
} from "./class-filter-panel";
import { pickDefaultPeriodValue } from "./period-preferences";

const STORAGE_VERSION = 11;

const RAW_COLUMN_LABELS: Record<string, string> = {
  id: "ID",
  uid: "학생 UID",
  name: "이름",
  class_name: "수업명",
  className: "수업명",
  academic_year: "연도",
  academicYear: "연도",
  year: "연도",
  term: "학기",
  period: "학기",
  school_category: "학교 분류",
  schoolCategory: "학교 분류",
  school: "학교",
  grade: "학년",
  contact: "연락처",
  parent_contact: "학부모 연락처",
  enroll_date: "등록일",
  class_ids: "수강 반 ID",
  waitlist_class_ids: "대기 반 ID",
  subject: "과목",
  teacher: "선생님",
  teacher_name: "선생님",
  teacherName: "선생님",
  schedule: "요일/시간",
  room: "강의실",
  classroom: "강의실",
  capacity: "정원",
  status: "상태",
  textbook_ids: "교재 ID",
  fee: "수업료",
  tuition: "수업료",
  publisher: "출판사",
  title: "교재명",
  price: "가격",
  tags: "태그",
  lessons: "단원",
  updated_at: "수정일",
  updatedAt: "수정일",
  created_at: "생성일",
  createdAt: "생성일",
};

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
  "action",
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

const STUDENT_SCHOOL_CATEGORY_OPTIONS = ["고등", "중등", "초등"] as const;

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50, 100, 200, 300, 400, 500] as const;

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

type PeriodOption = {
  value: string;
  label: string;
  aliases: string[];
};

type ManagementTableActions = {
  onCreate?: () => void;
  onOpenRow?: (row: ManagementRow) => void;
  onDeleteRow?: (row: ManagementRow) => void;
  onOpenSchoolMaster?: () => void;
  onOpenTeacherMaster?: () => void;
  onOpenClassroomMaster?: () => void;
  onOpenTermManager?: () => void;
};

function getStatusColor(value: string) {
  if (value === "수강" || value === "수업 진행 중" || value === "assigned" || value === "has-lessons") {
    return "text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/20";
  }

  if (value === "개강 준비" || value === "개강 준비 중" || value === "waitlist") {
    return "text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-900/20";
  }

  if (value === "unassigned" || value === "no-lessons" || value === "종강") {
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

function getPinnedColumnClassName(columnId: string) {
  if (columnId === "select") {
    return "sticky left-0 z-20 bg-background";
  }
  if (columnId === "title") {
    return "sticky left-[40px] z-10 bg-background";
  }
  return "";
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

function normalizeStudentSchoolCategory(value: unknown) {
  const normalized = normalizeScalar(value);
  if (!normalized) {
    return "";
  }

  if (normalized.includes("고")) return "고등";
  if (normalized.includes("중")) return "중등";
  if (normalized.includes("초")) return "초등";
  return normalized;
}

function getStudentSchool(row: ManagementRow) {
  return normalizeScalar((row.raw || {}).school);
}

function getStudentGrade(row: ManagementRow) {
  return normalizeScalar((row.raw || {}).grade);
}

function getStudentSchoolCategory(row: ManagementRow) {
  const raw = row.raw || {};
  const explicitCategory = normalizeStudentSchoolCategory(
    raw.school_category ||
      raw.schoolCategory ||
      raw.school_level ||
      raw.schoolLevel ||
      raw.category,
  );
  if (explicitCategory) {
    return explicitCategory;
  }

  const grade = getStudentGrade(row);
  if (grade.startsWith("고")) return "고등";
  if (grade.startsWith("중")) return "중등";
  if (grade.startsWith("초")) return "초등";
  return "";
}

function sortStudentSchoolCategories(values: string[]) {
  return [...values].sort((a, b) => {
    const aIndex = STUDENT_SCHOOL_CATEGORY_OPTIONS.indexOf(a as (typeof STUDENT_SCHOOL_CATEGORY_OPTIONS)[number]);
    const bIndex = STUDENT_SCHOOL_CATEGORY_OPTIONS.indexOf(b as (typeof STUDENT_SCHOOL_CATEGORY_OPTIONS)[number]);
    if (aIndex !== -1 || bIndex !== -1) {
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    }
    return a.localeCompare(b, "ko", { numeric: true });
  });
}

function sortStudentGradeOptions(values: string[]) {
  return [...values].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
}

function getClassAcademicYear(row: ManagementRow) {
  const raw = row.raw || {};
  const explicitYear = normalizeScalar(
    raw.academic_year ||
      raw.academicYear ||
      raw.year ||
      raw.term_year ||
      raw.termYear,
  );
  if (explicitYear) {
    return explicitYear;
  }

  const dateText = normalizeScalar(
    raw.start_date ||
      raw.startDate ||
      raw.end_date ||
      raw.endDate ||
      raw.created_at ||
      raw.createdAt,
  );
  const yearMatch = dateText.match(/\d{4}/);
  return yearMatch?.[0] || "";
}

function getClassTerm(row: ManagementRow) {
  const raw = row.raw || {};
  return normalizeScalar(
    raw.term ||
      raw.term_name ||
      raw.termName ||
      raw.semester ||
      raw.academic_term ||
      raw.academicTerm ||
      raw.period,
  );
}

function normalizePeriodLabel(value: unknown) {
  return normalizeScalar(value)
    .replace(/\b(20\d{2})\s+\1(?=\s|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPeriodLabel(year: string, term: string) {
  const normalizedYear = normalizePeriodLabel(year);
  const normalizedTerm = normalizePeriodLabel(term);
  if (!normalizedTerm) {
    return normalizedYear;
  }

  if (normalizedYear && normalizedTerm.includes(normalizedYear)) {
    return normalizedTerm;
  }

  return normalizePeriodLabel([normalizedYear, normalizedTerm].filter(Boolean).join(" "));
}

function getLegacyClassPeriodLabel(row: ManagementRow) {
  return buildPeriodLabel(getClassAcademicYear(row), getClassTerm(row));
}

function getClassGroupValues(row: ManagementRow) {
  const raw = row.raw || {};
  const directIds = Array.isArray(raw.classGroupIds)
    ? raw.classGroupIds
    : Array.isArray(raw.class_group_ids)
      ? raw.class_group_ids
      : [];
  const directNames = Array.isArray(raw.classGroupNames)
    ? raw.classGroupNames
    : Array.isArray(raw.class_group_names)
      ? raw.class_group_names
      : [];
  const directGroups = Array.isArray(raw.classGroups)
    ? raw.classGroups
    : Array.isArray(raw.class_groups)
      ? raw.class_groups
      : [];
  const metricNames = Array.isArray(row.metrics.classGroupNames) ? row.metrics.classGroupNames : [];

  const assignedGroups = [
    ...directIds.map(normalizeScalar),
    ...directNames.map(normalizePeriodLabel),
    ...metricNames.map(normalizePeriodLabel),
    ...directGroups.map((group) => {
      if (group && typeof group === "object") {
        const record = group as Record<string, unknown>;
        return [normalizeScalar(record.id), normalizePeriodLabel(record.name)].filter(Boolean).join("\n");
      }
      return normalizePeriodLabel(group);
    }),
  ]
    .flatMap((value) => value.split("\n"))
    .filter(Boolean);

  if (assignedGroups.length > 0) {
    return [...new Set(assignedGroups)];
  }

  return [...new Set([getLegacyClassPeriodLabel(row)].filter(Boolean))];
}

function getAvailableClassGroupOptions(rows: ManagementRow[]): PeriodOption[] {
  const byLabel = new Map<string, PeriodOption>();
  const upsertOption = (labelValue: string, optionValue: string, aliases: string[]) => {
    const rawLabel = normalizeScalar(labelValue);
    const label = normalizePeriodLabel(rawLabel);
    const value = normalizeScalar(optionValue) || label;
    if (!label || !value) {
      return;
    }

    const key = label.replace(/\s+/g, " ");
    const existing = byLabel.get(key);
    if (existing) {
      existing.aliases = [...new Set([...existing.aliases, ...aliases.map(normalizeScalar), rawLabel, value, label].filter(Boolean))];
      return;
    }

    byLabel.set(key, {
      value,
      label,
      aliases: [...new Set([...aliases.map(normalizeScalar), rawLabel, value, label].filter(Boolean))],
    });
  };

  for (const row of rows) {
    const raw = row.raw || {};
    const availableGroups = Array.isArray(raw.availableClassGroups)
      ? raw.availableClassGroups
      : Array.isArray(raw.available_class_groups)
        ? raw.available_class_groups
        : [];

    for (const group of availableGroups) {
      if (!group || typeof group !== "object") {
        const label = normalizeScalar(group);
        upsertOption(label, label, [label]);
        continue;
      }

      const record = group as Record<string, unknown>;
      const id = normalizeScalar(record.id);
      const label = normalizeScalar(record.name) || id;
      const value = id || label;
      upsertOption(label, value, [value, label]);
    }
  }

  return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label, "ko", { numeric: true }));
}

function getPeriodFilterLabel(options: PeriodOption[], value: string) {
  return options.find((option) => option.value === value || option.aliases.includes(value))?.label || value;
}

function findPeriodOption(options: PeriodOption[], value: string) {
  if (!value) {
    return undefined;
  }

  return options.find((option) => option.value === value || option.aliases.includes(value));
}

function resolvePeriodFilterValue(options: PeriodOption[], value: string, fallback: string) {
  if (options.length === 0) {
    return "";
  }

  const selectedOption = findPeriodOption(options, value);
  if (selectedOption) {
    return selectedOption.value;
  }

  const fallbackOption = findPeriodOption(options, fallback);
  return fallbackOption?.value || options[0]?.value || "";
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

function getClassCount(row: ManagementRow, key: "registered" | "waitlist") {
  const raw = row.raw || {};
  const value = key === "registered"
    ? raw.registeredCount || raw.registered_count || row.metrics.studentCount
    : raw.waitlistCount || raw.waitlist_count || row.metrics.waitlistCount;
  const count = Number(value || 0);
  return Number.isFinite(count) ? count : 0;
}

function getClassCapacity(row: ManagementRow) {
  const raw = row.raw || {};
  const capacity = Number(raw.capacity || row.metrics.capacity || 0);
  return Number.isFinite(capacity) && capacity > 0 ? capacity : 0;
}

function parseWeeklyMinutes(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 60) : 0;
  }

  const text = normalizeScalar(value);
  if (!text) {
    return 0;
  }

  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*시간/);
  const minuteMatch = text.match(/(\d+)\s*분/);
  if (hourMatch || minuteMatch) {
    const hours = hourMatch ? Number(hourMatch[1]) : 0;
    const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
    return Math.round(hours * 60 + minutes);
  }

  const numeric = Number(text);
  return Number.isFinite(numeric) ? Math.round(numeric * 60) : 0;
}

function formatWeeklyMinutes(totalMinutes: number) {
  const safeMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}시간${String(minutes).padStart(2, "0")}분`;
}

function formatManagementCurrency(value: unknown) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "-";
  }
  return `${new Intl.NumberFormat("ko-KR").format(amount)}원`;
}

function renderClassScheduleCell(row: ManagementRow) {
  const scheduleLines = Array.isArray((row.raw || {}).scheduleLines)
    ? ((row.raw || {}).scheduleLines as string[])
    : Array.isArray((row.raw || {}).schedule_lines)
      ? ((row.raw || {}).schedule_lines as string[])
      : [];
  const lines = scheduleLines.length > 0 ? scheduleLines : [normalizeScalar((row.raw || {}).schedule)].filter(Boolean);
  if (lines.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }
  return (
    <div className="grid min-w-[11rem] gap-1 py-0.5 text-sm text-foreground">
      {lines.map((line, index) => (
        <span key={`${row.id}-schedule-${index}`} className="leading-5">
          {line}
        </span>
      ))}
    </div>
  );
}

type ClassStudentSummary = {
  id?: string;
  name?: string;
  school?: string;
  grade?: string;
};

function normalizeClassStudentSummaries(value: unknown): ClassStudentSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return {
          id: normalizeScalar(record.id),
          name: normalizeScalar(record.name),
          school: normalizeScalar(record.school),
          grade: normalizeScalar(record.grade),
        };
      }

      return {
        id: normalizeScalar(item),
        name: normalizeScalar(item),
      };
    })
    .filter((student) => student.name || student.id);
}

function formatClassStudentSummary(student: ClassStudentSummary) {
  const name = student.name || student.id || "학생";
  const school = student.school || "";
  const grade = school && student.grade?.startsWith(school.slice(-1))
    ? student.grade.slice(1)
    : student.grade || "";
  const schoolGrade = [school, grade].filter(Boolean).join("");
  return schoolGrade ? `${name}(${schoolGrade})` : name;
}

function sortClassStudentSummariesAscending(students: ClassStudentSummary[]) {
  return [...students].sort((a, b) =>
    formatClassStudentSummary(a).localeCompare(formatClassStudentSummary(b), "ko"),
  );
}

function renderEnrollmentRosterPopover(
  label: "등록" | "대기",
  count: number,
  students: ClassStudentSummary[],
) {
  const sortedStudents = sortClassStudentSummariesAscending(students);
  const toneClassName =
    label === "등록"
      ? "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-950/50"
      : "bg-orange-50 text-orange-700 hover:bg-orange-100 dark:bg-orange-950/30 dark:text-orange-300 dark:hover:bg-orange-950/50";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("relative z-20 h-6 rounded-full px-2.5 text-xs font-medium", toneClassName)}
          aria-label={`${label} 학생 ${count}명 보기`}
          onClick={(event) => event.stopPropagation()}
        >
          {label} {count}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-64 rounded-lg p-0 shadow-lg">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="text-sm font-semibold">{label} 학생</div>
          <Badge variant="secondary" className="h-5 rounded-full px-2 text-[11px]">
            {count}명
          </Badge>
        </div>
        <div className="max-h-64 overflow-y-auto p-2">
          {sortedStudents.length > 0 ? (
            <div className="grid gap-1">
              {sortedStudents.map((student, index) => (
                <div
                  key={`${label}-${student.id || student.name || index}`}
                  className="rounded-md px-2 py-1.5 text-sm leading-5 hover:bg-muted/70"
                >
                  {formatClassStudentSummary(student)}
                </div>
              ))}
            </div>
          ) : (
            <div className="px-2 py-5 text-center text-sm text-muted-foreground">
              표시할 학생이 없습니다.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function renderEnrollmentStatusCell(row: ManagementRow) {
  const registeredCount = Number((row.raw || {}).registeredCount || (row.raw || {}).registered_count || row.metrics.studentCount || 0);
  const waitlistCount = Number((row.raw || {}).waitlistCount || (row.raw || {}).waitlist_count || row.metrics.waitlistCount || 0);
  const capacity = getClassCapacity(row);
  const capacityStatus = capacity > 0
    ? normalizeScalar((row.raw || {}).capacityStatus || (row.raw || {}).capacity_status) || `${registeredCount}/${capacity}`
    : "";
  const registeredStudents = normalizeClassStudentSummaries((row.raw || {}).registeredStudents || (row.raw || {}).registered_students);
  const waitlistStudents = normalizeClassStudentSummaries((row.raw || {}).waitlistStudents || (row.raw || {}).waitlist_students);

  return (
    <div className="flex min-w-[12rem] flex-wrap items-center gap-2 py-0.5">
      {renderEnrollmentRosterPopover("등록", registeredCount, registeredStudents)}
      {renderEnrollmentRosterPopover("대기", waitlistCount, waitlistStudents)}
      {capacityStatus ? <span className="text-xs text-muted-foreground">정원 {capacityStatus}</span> : null}
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

  if (mode === "none") {
    return (
      <Badge variant="secondary" className={getStatusColor(row.statusValue)}>
        {row.status}
      </Badge>
    );
  }

  const label = mode === "registered" ? "수강" : "대기";
  const count = mode === "registered" ? registeredCount : waitlistCount;
  const classList = getStudentClassSummaries(row, mode);
  const sortedClassList = [...classList].sort((a, b) =>
    (a.name || a.id || "").localeCompare(b.name || b.id || "", "ko", { numeric: true }),
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "relative z-20 h-6 rounded-full px-2.5 text-xs font-medium",
            mode === "registered"
              ? "bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-950/30 dark:text-green-300 dark:hover:bg-green-950/50"
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
  );
}

function renderClassCapacityCell(row: ManagementRow) {
  const capacity = getClassCapacity(row);
  return capacity > 0 ? <span className="text-sm text-foreground">{capacity}</span> : null;
}

function renderPlainCell(value: unknown, className = "text-sm text-foreground") {
  const normalized = normalizeScalar(value);
  if (!normalized) {
    return <span className="text-muted-foreground">-</span>;
  }
  return <span className={className}>{normalized}</span>;
}

function renderValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">-</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground">[]</span>;
    }

    if (value.every((entry) => typeof entry !== "object" || entry === null)) {
      return <span className="text-sm">{value.map((entry) => normalizeScalar(entry)).join(", ")}</span>;
    }

    return (
      <pre className="max-w-[28rem] overflow-hidden text-ellipsis whitespace-pre-wrap break-all text-xs text-muted-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  if (typeof value === "object") {
    return (
      <pre className="max-w-[28rem] overflow-hidden text-ellipsis whitespace-pre-wrap break-all text-xs text-muted-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  if (typeof value === "boolean") {
    return <span>{value ? "true" : "false"}</span>;
  }

  return <span className="text-sm">{String(value)}</span>;
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

export function ManagementDataTable({
  kind,
  rows,
  stats,
  loading,
  onRefresh,
  badgeLabel,
  statusLabel,
  emptyLabel,
  actions = {},
}: {
  kind: ManagementKind;
  rows: ManagementRow[];
  stats: ManagementStat[];
  loading: boolean;
  onRefresh: () => void;
  badgeLabel: string;
  statusLabel: string;
  emptyLabel: string;
  actions?: ManagementTableActions;
}) {
  const storageKey = `tips-management-table:${kind}:v${STORAGE_VERSION}`;
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [rowSelection, setRowSelection] = useState({});
  const [globalFilter, setGlobalFilter] = useState("");
  const [classGroupFilter, setClassGroupFilter] = useState("");
  const [studentSchoolCategoryFilter, setStudentSchoolCategoryFilter] = useState("");
  const [studentSchoolFilter, setStudentSchoolFilter] = useState("");
  const [studentGradeFilter, setStudentGradeFilter] = useState("");
  const [grouping, setGrouping] = useState<GroupingState>([]);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [columnSearchQuery, setColumnSearchQuery] = useState("");
  const [hydratedStorageKey, setHydratedStorageKey] = useState("");

  const columns = useMemo<ColumnDef<ManagementRow>[]>(() => {
    const fixedColumns: ColumnDef<ManagementRow>[] = [
      {
        id: "select",
        header: ({ table }) => (
          <div className="flex items-center justify-center px-1">
            <Checkbox
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
          <div className="flex items-center justify-center px-1">
            <Checkbox
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
          <div className="grid min-w-[14rem] gap-0.5 py-0.5">
            <button
              type="button"
              className={cn(
                "-mx-1.5 inline-flex max-w-full cursor-pointer rounded-md px-1.5 py-1 text-left text-sm font-medium leading-5 underline-offset-4 transition-colors hover:bg-primary/5 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 active:translate-y-px",
                kind === "classes" ? "text-blue-600 dark:text-blue-400" : "text-foreground",
              )}
              onClick={() => actions.onOpenRow?.(row.original)}
            >
              <span className="truncate">{row.original.title}</span>
            </button>
            {kind === "textbooks" ? (
              <span className="truncate text-xs text-muted-foreground">{row.original.subtitle || "기본 정보 없음"}</span>
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
        cell: ({ row }) => renderPlainCell((row.original.raw || {}).teacher || (row.original.raw || {}).teacher_name || (row.original.raw || {}).teacherName),
        filterFn: (row, _, value) => !value || getClassFilterValues(row.original, "teacher").includes(String(value)),
      },
      {
        id: "classroom",
        accessorFn: (row) => normalizeScalar((row.raw || {}).classroom || (row.raw || {}).room),
        header: "강의실",
        cell: ({ row }) => renderPlainCell((row.original.raw || {}).classroom || (row.original.raw || {}).room),
        filterFn: (row, _, value) => !value || getClassFilterValues(row.original, "classroom").includes(String(value)),
      },
      {
        id: "enrollmentStatus",
        accessorFn: (row) => normalizeScalar((row.raw || {}).capacityStatus || (row.raw || {}).capacity_status),
        header: "수강 현황",
        cell: ({ row }) => renderEnrollmentStatusCell(row.original),
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
        cell: ({ row }) => (
          <div className="flex items-center justify-center">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
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
    });
  }, [actions, badgeLabel, emptyLabel, kind, statusLabel]);

  const allColumnIds = useMemo(() => columns.map((column) => String(column.id ?? "")).filter(Boolean), [columns]);

  const defaultVisibility = useMemo(() => buildDefaultVisibility(kind, allColumnIds), [allColumnIds, kind]);
  const defaultColumnSizing = useMemo(() => buildDefaultColumnSizing(allColumnIds), [allColumnIds]);

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
      setSorting(sanitized.sorting);
      setGrouping(sanitized.grouping);
    } catch {
      setColumnVisibility(fallback.columnVisibility);
      setColumnOrder(fallback.columnOrder);
      setColumnSizing(fallback.columnSizing);
      setSorting(fallback.sorting);
      setGrouping(fallback.grouping);

      if (typeof window !== "undefined") {
        window.localStorage.removeItem(storageKey);
      }
    }

    setHydratedStorageKey(storageKey);
  }, [allColumnIds, defaultColumnSizing, defaultVisibility, kind, storageKey]);

  useEffect(() => {
    if (typeof window === "undefined" || hydratedStorageKey !== storageKey) {
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
  }, [columnOrder, columnSizing, columnVisibility, grouping, hydratedStorageKey, sorting, storageKey]);

  const periodOptions = useMemo(
    () => (kind === "classes" ? getAvailableClassGroupOptions(rows) : []),
    [kind, rows],
  );
  const defaultPeriodFilter = useMemo(() => pickDefaultPeriodValue(periodOptions), [periodOptions]);
  const effectiveClassGroupFilter = useMemo(
    () =>
      kind === "classes"
        ? resolvePeriodFilterValue(periodOptions, classGroupFilter, defaultPeriodFilter)
        : classGroupFilter,
    [classGroupFilter, defaultPeriodFilter, kind, periodOptions],
  );
  const studentSchoolCategoryOptions = useMemo(
    () =>
      kind === "students"
        ? sortStudentSchoolCategories([...new Set(rows.map(getStudentSchoolCategory).filter(Boolean))])
        : [],
    [kind, rows],
  );
  const studentSchoolOptions = useMemo(() => {
    if (kind !== "students") {
      return [];
    }

    return [...new Set(
      rows
        .filter((row) => !studentSchoolCategoryFilter || getStudentSchoolCategory(row) === studentSchoolCategoryFilter)
        .map(getStudentSchool)
        .filter(Boolean),
    )].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
  }, [kind, rows, studentSchoolCategoryFilter]);
  const studentGradeOptions = useMemo(() => {
    if (kind !== "students") {
      return [];
    }

    return sortStudentGradeOptions([
      ...new Set(
        rows
          .filter((row) => !studentSchoolCategoryFilter || getStudentSchoolCategory(row) === studentSchoolCategoryFilter)
          .filter((row) => !studentSchoolFilter || getStudentSchool(row) === studentSchoolFilter)
          .map(getStudentGrade)
          .filter(Boolean),
      ),
    ]);
  }, [kind, rows, studentSchoolCategoryFilter, studentSchoolFilter]);
  const tableSourceRows = useMemo(
    () => {
      if (kind === "classes") {
        return rows.filter((row) => {
          const selectedValue = effectiveClassGroupFilter;
          const selectedOption = findPeriodOption(periodOptions, selectedValue);
          const filterValues = selectedOption?.aliases || [selectedValue].filter(Boolean);
          const groups = getClassGroupValues(row);
          return filterValues.length === 0 || filterValues.some((value) => groups.includes(value));
        });
      }

      if (kind === "students") {
        return rows
          .filter((row) => !studentSchoolCategoryFilter || getStudentSchoolCategory(row) === studentSchoolCategoryFilter)
          .filter((row) => !studentSchoolFilter || getStudentSchool(row) === studentSchoolFilter)
          .filter((row) => !studentGradeFilter || getStudentGrade(row) === studentGradeFilter);
      }

      return rows;
    },
    [effectiveClassGroupFilter, kind, periodOptions, rows, studentGradeFilter, studentSchoolCategoryFilter, studentSchoolFilter],
  );

  useEffect(() => {
    if (kind !== "classes") {
      return;
    }

    if (periodOptions.length === 0) {
      if (classGroupFilter) {
        setClassGroupFilter("");
      }
      return;
    }

    if (classGroupFilter !== effectiveClassGroupFilter) {
      setClassGroupFilter(effectiveClassGroupFilter);
    }
  }, [classGroupFilter, effectiveClassGroupFilter, kind, periodOptions]);

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

  const table = useReactTable({
    data: tableSourceRows,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onColumnSizingChange: setColumnSizing,
    onRowSelectionChange: setRowSelection,
    onGroupingChange: setGrouping,
    onExpandedChange: setExpanded,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      columnOrder,
      columnSizing,
      rowSelection,
      globalFilter,
      grouping,
      expanded,
    },
    globalFilterFn: (row, _, value) => {
      const normalized = String(value || "").trim().toLowerCase();
      if (!normalized) {
        return true;
      }

      return row.original.searchText.toLowerCase().includes(normalized);
    },
    onGlobalFilterChange: setGlobalFilter,
    defaultColumn: {
      minSize: 72,
      size: 140,
      maxSize: 420,
    },
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  const badgeOptions = useMemo(
    () =>
      [...new Set(tableSourceRows.map((row) => row.badge).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")),
    [tableSourceRows],
  );

  const statusOptions = useMemo(
    () =>
      kind === "classes"
        ? [...CLASS_STATUS_FILTER_OPTIONS]
        : [...new Set(rows.map((row) => row.status).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")),
    [kind, rows],
  );

  const selectedSubjectFilter = (table.getColumn("subject")?.getFilterValue() as string) || "";

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
      const sourceRows = selectedSubjectFilter && (filter.id === "teacher" || filter.id === "classroom")
        ? tableSourceRows.filter((row) => getClassFilterValues(row, "subject").includes(selectedSubjectFilter))
        : tableSourceRows;
      current[filter.id] = sortClassFilterOptions(
        filter.id,
        [...new Set(sourceRows.flatMap((row) => getClassFilterValues(row, filter.id)))],
      );
      return current;
    }, emptyOptions);
  }, [kind, tableSourceRows, selectedSubjectFilter]);

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
  const classFilterValues = CLASS_FILTERS.map((filter) => ({
    ...filter,
    value: (table.getColumn(filter.id)?.getFilterValue() as string) || "",
  }));
  const activeClassFilters = kind === "classes" ? classFilterValues.filter((filter) => filter.value) : [];
  const normalizedClassGroupFilter = kind === "classes" ? effectiveClassGroupFilter : classGroupFilter;
  const normalizedClassStatusFilter = kind === "classes" ? statusFilter || DEFAULT_CLASS_STATUS_FILTER : statusFilter;
  const hasNonDefaultPeriodFilter = kind === "classes" && normalizedClassGroupFilter !== defaultPeriodFilter;
  const hasNonDefaultStatusFilter = kind === "classes" && normalizedClassStatusFilter !== DEFAULT_CLASS_STATUS_FILTER;
  const hasActiveStudentFilters = kind === "students" && Boolean(studentSchoolCategoryFilter || studentSchoolFilter || studentGradeFilter);
  const normalizedGlobalFilter = String(globalFilter || "").trim();
  const normalizedColumnSearchQuery = columnSearchQuery.trim().toLowerCase();
  const hasActiveFilters = Boolean(
    normalizedGlobalFilter ||
      badgeFilter ||
      (kind === "classes" ? hasNonDefaultStatusFilter : kind === "students" ? false : statusFilter) ||
      (kind === "classes" ? hasNonDefaultPeriodFilter : false) ||
      activeClassFilters.length > 0 ||
      hasActiveStudentFilters,
  );
  const filteredRowCount = table.getFilteredRowModel().rows.length;
  const filteredClassRows = kind === "classes"
    ? table.getFilteredRowModel().flatRows.map((row) => row.original)
    : [];
  const classRegisteredTotal = filteredClassRows.reduce((total, row) => total + getClassCount(row, "registered"), 0);
  const classWaitlistTotal = filteredClassRows.reduce((total, row) => total + getClassCount(row, "waitlist"), 0);
  const classWeeklyMinutesTotal = filteredClassRows.reduce((total, row) => {
    const raw = row.raw || {};
    return total + parseWeeklyMinutes(raw.weeklyHoursLabel || raw.weekly_hours_label || row.metrics.weeklyHoursLabel);
  }, 0);
  const summaryLabel = kind === "classes"
    ? `수업 ${filteredClassRows.length}개, 등록 ${classRegisteredTotal}명, 대기 ${classWaitlistTotal}명, 주간 수업시수 ${formatWeeklyMinutes(classWeeklyMinutesTotal)}`
    : `표시 ${filteredRowCount}건`;
  const selectedRowCount = table.getFilteredSelectedRowModel().rows.length;
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
  const currentPage = table.getState().pagination.pageIndex + 1;
  const totalPages = table.getPageCount() || 1;
  const pageSize = table.getState().pagination.pageSize;
  const visibleRangeStart = filteredRowCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const visibleRangeEnd = filteredRowCount === 0 ? 0 : Math.min(currentPage * pageSize, filteredRowCount);
  const captionSuffix = stats
    .filter((stat) => stat.value !== undefined && stat.value !== null)
    .slice(0, 2)
    .map((stat) => `${stat.label} ${stat.value}`)
    .join(" · ");
  const emptyStateTitle = rows.length === 0 ? `등록된 ${emptyLabel} 데이터가 없습니다.` : `현재 조건에 맞는 ${emptyLabel} 데이터가 없습니다.`;
  const emptyStateSummary = rows.length === 0 ? "관리 레코드가 아직 비어 있습니다." : hasActiveFilters ? "검색·필터 결과가 비어 있습니다." : "현재 표시 범위에 데이터가 없습니다.";
  const createLabel = kind === "students" ? "학생 등록" : kind === "classes" ? "수업 등록" : "교재 등록";
  const hasCreateAction = typeof actions.onCreate === "function";

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
    if (kind !== "students" || !statusColumn || !statusFilter) {
      return;
    }

    statusColumn.setFilterValue("");
  }, [kind, statusColumn, statusFilter]);

  const resetPreferences = () => {
    setColumnVisibility(defaultVisibility);
    setColumnOrder(buildDefaultColumnOrder(kind, allColumnIds));
    setColumnSizing(defaultColumnSizing);
    setSorting(buildDefaultSorting(kind, allColumnIds));
    setGrouping(buildDefaultGrouping(kind, allColumnIds));
    setExpanded({});
    setColumnSearchQuery("");
  };

  const resetFilters = () => {
    setGlobalFilter("");
    setClassGroupFilter(defaultPeriodFilter);
    setStudentSchoolCategoryFilter("");
    setStudentSchoolFilter("");
    setStudentGradeFilter("");
    badgeColumn?.setFilterValue("");
    if (kind === "classes") {
      statusColumn?.setFilterValue(DEFAULT_CLASS_STATUS_FILTER);
    } else if (kind !== "students") {
      statusColumn?.setFilterValue("");
    }
    for (const filter of CLASS_FILTERS) {
      table.getColumn(filter.id)?.setFilterValue("");
    }
    table.resetPagination();
  };

  const columnSettingsControl = (
    <Popover
      open={settingsOpen}
      onOpenChange={(open) => {
        setSettingsOpen(open);
        if (!open) {
          setColumnSearchQuery("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label="컬럼 구성" title="컬럼 구성">
          <Settings2 className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={10}
        className="w-[min(92vw,340px)] rounded-lg border bg-popover p-0 shadow-xl"
      >
        <div className="border-b px-3 py-2.5">
          <h3 className="text-sm font-semibold tracking-tight">{emptyLabel} 표 설정</h3>
        </div>

        <div className="max-h-[72vh] overflow-y-auto p-2">
          <div className="grid items-start gap-2">
            <div className="space-y-2">
              <div className="rounded-md border p-2">
                <h3 className="text-sm font-semibold">그룹화</h3>
                <div className="mt-2 grid gap-2">
                  <div className="space-y-2">
                    <Label>1단 그룹</Label>
                    <Select
                      value={primaryGrouping}
                      onValueChange={(value) => setGrouping(buildGroupingValue(value === "none" ? "" : value, secondaryGrouping === "none" ? "" : secondaryGrouping === value ? "" : secondaryGrouping))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="없음" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">없음</SelectItem>
                        {columnOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>2단 그룹</Label>
                    <Select
                      value={secondaryGrouping}
                      onValueChange={(value) => setGrouping(buildGroupingValue(primaryGrouping === "none" ? "" : primaryGrouping, value === "none" || value === primaryGrouping ? "" : value))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="없음" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">없음</SelectItem>
                        {columnOptions
                          .filter((option) => option.id !== primaryGrouping)
                          .map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="rounded-md border p-2">
                <h3 className="text-sm font-semibold">정렬</h3>
                <div className="mt-2 grid gap-2">
                  <div className="space-y-2">
                    <Label>1차 컬럼</Label>
                    <Select
                      value={primarySorting}
                      onValueChange={(value) => setSorting(buildSortingValue(value === "none" ? "" : value, primarySortDirection as "asc" | "desc", secondarySorting === "none" ? "" : secondarySorting === value ? "" : secondarySorting, secondarySortDirection as "asc" | "desc"))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="없음" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">없음</SelectItem>
                        {columnOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>1차 방향</Label>
                    <Select
                      value={primarySortDirection}
                      onValueChange={(value) => setSorting(buildSortingValue(primarySorting === "none" ? "" : primarySorting, value as "asc" | "desc", secondarySorting === "none" ? "" : secondarySorting, secondarySortDirection as "asc" | "desc"))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="asc">오름차순</SelectItem>
                        <SelectItem value="desc">내림차순</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>2차 컬럼</Label>
                    <Select
                      value={secondarySorting}
                      onValueChange={(value) => setSorting(buildSortingValue(primarySorting === "none" ? "" : primarySorting, primarySortDirection as "asc" | "desc", value === "none" || value === primarySorting ? "" : value, secondarySortDirection as "asc" | "desc"))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="없음" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">없음</SelectItem>
                        {columnOptions
                          .filter((option) => option.id !== primarySorting)
                          .map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>2차 방향</Label>
                    <Select
                      value={secondarySortDirection}
                      onValueChange={(value) => setSorting(buildSortingValue(primarySorting === "none" ? "" : primarySorting, primarySortDirection as "asc" | "desc", secondarySorting === "none" ? "" : secondarySorting, value as "asc" | "desc"))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="asc">오름차순</SelectItem>
                        <SelectItem value="desc">내림차순</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-md border p-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">컬럼 구성</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    표시 {visibleColumns} / 전체 {columnOptions.length}열
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={resetPreferences}>
                  기본값으로 복원
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={columnSearchQuery}
                    onChange={(event) => setColumnSearchQuery(event.target.value)}
                    placeholder="검색할 컬럼 이름"
                    className="h-8 pl-9"
                  />
                </div>

                {matchingColumnOrder.length === 0 ? (
                  <div className="rounded-md border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
                    일치하는 컬럼이 없습니다.
                  </div>
                ) : (
                  <div className="grid gap-1">
                    {matchingColumnOrder.map((columnId) => {
                      const option = columnOptions.find((item) => item.id === columnId);
                      const column = table.getColumn(columnId);
                      const currentColumnIndex = columnOrder.indexOf(columnId);
                      if (!option || !column || currentColumnIndex === -1) {
                        return null;
                      }
                      const currentColumnWidth = column.getSize();

                      return (
                        <div key={columnId} className="grid gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60 sm:grid-cols-[minmax(0,1fr)_4.75rem_auto] sm:items-center">
                          <div className="flex min-w-0 items-center gap-3">
                            <Checkbox
                              checked={column.getIsVisible()}
                              onCheckedChange={(value) => column.toggleVisibility(!!value)}
                              disabled={!column.getCanHide()}
                            />
                            <span className="min-w-0 truncate text-sm font-medium">{option.label}</span>
                          </div>
                          <div>
                            <Input
                              id={`column-width-${kind}-${columnId}`}
                              aria-label={`${option.label} 너비`}
                              type="number"
                              min={72}
                              max={420}
                              step={8}
                              value={currentColumnWidth}
                              onChange={(event) =>
                                setColumnSizing((current) => ({
                                  ...current,
                                  [columnId]: normalizeColumnWidth(event.target.value, currentColumnWidth),
                                }))
                              }
                              className="h-7 px-2 text-xs"
                            />
                          </div>
                          <div className="flex items-center justify-end gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              onClick={() => setColumnOrder((current) => reorderColumns(current, columnId, "up"))}
                              disabled={currentColumnIndex === 1}
                            >
                              <ArrowUp className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              onClick={() => setColumnOrder((current) => reorderColumns(current, columnId, "down"))}
                              disabled={currentColumnIndex === columnOrder.length - 1}
                            >
                              <ArrowDown className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );

  const searchControl = (
    <div className="relative min-w-0">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-label="검색"
        placeholder={`${emptyLabel} 검색`}
        value={globalFilter ?? ""}
        onChange={(event) => setGlobalFilter(String(event.target.value))}
        className="h-9 pl-9"
      />
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
            id: "period",
            label: "기간",
            value: normalizedClassGroupFilter || "none",
            options: periodOptions.map((option) => ({
              value: option.value,
              label: option.label,
            })),
            emptyValue: "none",
            emptyLabel: "기간 없음",
            disabled: periodOptions.length === 0,
            onChange: (value) => {
              if (value === "none") {
                return;
              }
              setClassGroupFilter(value);
              table.resetPagination();
            },
          },
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
              table.resetPagination();
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
                column?.setFilterValue(value === "all" ? "" : value);
                if (filter.id === "subject") {
                  table.getColumn("teacher")?.setFilterValue("");
                  table.getColumn("classroom")?.setFilterValue("");
                }
                table.resetPagination();
              },
            };
          }),
        ]
      : [];

  const classFilterChips: ClassFilterPanelChip[] =
    kind === "classes"
      ? [
          rows.length !== filteredRowCount
            ? { id: "total", label: <>전체 {rows.length}건</> }
            : null,
          selectedRowCount > 0
            ? { id: "selected", label: <>선택 {selectedRowCount}건</> }
            : null,
          grouping.length > 0
            ? { id: "grouping", label: <>그룹 {grouping.length}단</> }
            : null,
          normalizedGlobalFilter
            ? { id: "search", label: <>검색어 {normalizedGlobalFilter}</> }
            : null,
          hasNonDefaultPeriodFilter
            ? {
                id: "period",
                label: <>기간 {getPeriodFilterLabel(periodOptions, normalizedClassGroupFilter)}</>,
              }
            : null,
          hasNonDefaultStatusFilter
            ? { id: "status", label: <>{statusLabel} {normalizedClassStatusFilter}</> }
            : null,
          ...activeClassFilters.map((filter) => ({
            id: filter.id,
            label: <>{filter.label} {filter.value}</>,
          })),
        ].filter(Boolean) as ClassFilterPanelChip[]
      : [];

  const renderStudentSchoolCategorySelect = () => (
    <div className="min-w-0">
      <Label htmlFor="student-school-category-filter" className="sr-only">
        학교 구분
      </Label>
      <Select
        value={studentSchoolCategoryFilter || "all"}
        onValueChange={(value) => {
          setStudentSchoolCategoryFilter(value === "all" ? "" : value);
          setStudentSchoolFilter("");
          setStudentGradeFilter("");
          table.resetPagination();
        }}
      >
        <SelectTrigger className="h-9 w-full" id="student-school-category-filter" aria-label="학교 구분">
          <SelectValue placeholder="학교 구분" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">전체 학교 구분</SelectItem>
          {studentSchoolCategoryOptions.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
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
          setStudentSchoolFilter(value === "all" ? "" : value);
          setStudentGradeFilter("");
          table.resetPagination();
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
          setStudentGradeFilter(value === "all" ? "" : value);
          table.resetPagination();
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

  return (
    <div className="w-full space-y-3">
      {kind === "classes" ? (
        <ClassFilterPanel
          selects={classFilterSelects}
          searchValue={String(globalFilter || "")}
          searchPlaceholder={`${emptyLabel} 검색`}
          onSearchChange={(value) => setGlobalFilter(value)}
          summaryLabel={summaryLabel}
          chips={classFilterChips}
          showReset={hasActiveFilters}
          onReset={resetFilters}
          createLabel={createLabel}
          onCreate={actions.onCreate}
          createDisabled={!hasCreateAction}
          footerAction={
            selectedRowCount > 0 ? (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setRowSelection({})}>
                선택 해제
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="flex flex-col gap-2 border border-border/70 bg-background px-3 py-3">
          <div
            className={cn(
              "grid gap-2",
              kind === "students"
                ? "md:grid-cols-2 xl:grid-cols-[minmax(9rem,0.8fr)_minmax(12rem,1fr)_minmax(9rem,0.8fr)_minmax(18rem,1.45fr)_9rem]"
                : "md:grid-cols-2 xl:grid-cols-[minmax(18rem,1fr)_minmax(14rem,1fr)_11rem_auto]",
            )}
          >
            {kind === "students" ? (
              <>
                {renderStudentSchoolCategorySelect()}
                {renderStudentSchoolSelect()}
                {renderStudentGradeSelect()}
                {searchControl}
                {createControl}
              </>
            ) : (
              <>
                {badgeColumn ? (
                  <div className="min-w-0">
                    <Label htmlFor="badge-filter" className="sr-only">
                      {badgeLabel}
                    </Label>
                    <Select
                      value={badgeFilter || "all"}
                      onValueChange={(value) => badgeColumn.setFilterValue(value === "all" ? "" : value)}
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
                {searchControl}
                <div className="min-w-0">
                  <Label htmlFor="status-filter" className="sr-only">
                    {statusLabel}
                  </Label>
                  <Select
                    value={statusFilter || "all"}
                    onValueChange={(value) => statusColumn?.setFilterValue(value === "all" ? "" : value)}
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
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{summaryLabel}</Badge>
            {rows.length !== filteredRowCount ? <Badge variant="outline">전체 {rows.length}건</Badge> : null}
            {selectedRowCount > 0 ? <Badge variant="outline">선택 {selectedRowCount}건</Badge> : null}
            {grouping.length > 0 ? <Badge variant="outline">그룹 {grouping.length}단</Badge> : null}
            {normalizedGlobalFilter ? <Badge variant="outline">검색어 {normalizedGlobalFilter}</Badge> : null}
            {badgeFilter ? <Badge variant="outline">{badgeLabel} {badgeFilter}</Badge> : null}
            {kind !== "students" && statusFilter ? <Badge variant="outline">{statusLabel} {statusFilter}</Badge> : null}
            {studentSchoolCategoryFilter ? <Badge variant="outline">학교 구분 {studentSchoolCategoryFilter}</Badge> : null}
            {studentSchoolFilter ? <Badge variant="outline">학교 {studentSchoolFilter}</Badge> : null}
            {studentGradeFilter ? <Badge variant="outline">학년 {studentGradeFilter}</Badge> : null}
            {resetControl}
            {selectedRowCount > 0 ? (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setRowSelection({})}>
                선택 해제
              </Button>
            ) : null}
          </div>
        </div>
      )}

      <div className="overflow-hidden border border-border/70 bg-background">
        <Table className="table-fixed">
          <caption className="sr-only">{emptyLabel} 운영 목록{captionSuffix ? ` · ${captionSuffix}` : ""}</caption>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sortState = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  const columnLabel = formatColumnLabel(header.id, badgeLabel, statusLabel, kind);
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={sortState === "asc" ? "ascending" : sortState === "desc" ? "descending" : undefined}
                      className={cn(
                        "sticky top-0 z-10 border-b bg-background px-3 py-2 text-xs font-semibold text-foreground relative",
                        getPinnedColumnClassName(header.id),
                      )}
                      style={getColumnSizeStyle(header.getSize())}
                    >
                      {header.isPlaceholder ? null : (
                        <>
                          <div className={cn(header.id === "select" || header.id === "action" ? "flex items-center justify-center" : "pr-3")}>
                            {header.id === "action" ? (
                              columnSettingsControl
                            ) : canSort ? (
                              <button
                                type="button"
                                className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded px-1 text-left font-semibold hover:bg-muted/70"
                                onClick={() => header.column.toggleSorting(sortState === "asc")}
                                aria-label={`${columnLabel} ${sortState === "asc" ? "내림차순" : "오름차순"} 정렬`}
                              >
                                <span className="min-w-0 truncate">
                                  {flexRender(header.column.columnDef.header, header.getContext())}
                                </span>
                                {sortState === "asc" ? (
                                  <ArrowUp className="size-3.5 shrink-0 text-primary" />
                                ) : sortState === "desc" ? (
                                  <ArrowDown className="size-3.5 shrink-0 text-primary" />
                                ) : (
                                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/50" />
                                )}
                              </button>
                            ) : (
                              flexRender(header.column.columnDef.header, header.getContext())
                            )}
                          </div>
                          {header.column.getCanResize() ? (
                            <button
                              type="button"
                              aria-label={`${columnLabel} 너비 조절`}
                              className={cn(
                                "absolute right-0 top-0 h-full w-2 cursor-col-resize border-l border-transparent transition-colors hover:border-border hover:bg-accent/30",
                                header.column.getIsResizing() ? "border-primary bg-primary/15" : "",
                              )}
                              onMouseDown={header.getResizeHandler()}
                              onTouchStart={header.getResizeHandler()}
                              onDoubleClick={() => header.column.resetSize()}
                            />
                          ) : null}
                        </>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, index) => (
                <TableRow key={`loading-${index}`}>
                  <TableCell colSpan={table.getVisibleLeafColumns().length || columns.length}>
                    <Skeleton className="h-10 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className="border-b transition-colors hover:bg-muted/30 last:border-b-0"
                >
                  {row.getVisibleCells().map((cell) => {
                    if (cell.getIsGrouped()) {
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn("px-3 py-2 align-top", getPinnedColumnClassName(cell.column.id))}
                          style={getColumnSizeStyle(cell.column.getSize())}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto px-0 py-0 font-normal"
                            onClick={row.getToggleExpandedHandler()}
                          >
                            {row.getIsExpanded() ? <ChevronDown className="mr-2 size-4" /> : <ChevronRight className="mr-2 size-4" />}
                            <span className="max-w-[18rem] truncate">{String(cell.getValue() || "값 없음")}</span>
                            <Badge variant="secondary" className="ml-2">{row.subRows.length}건</Badge>
                          </Button>
                        </TableCell>
                      );
                    }

                    if (cell.getIsPlaceholder()) {
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn("px-3 py-2 align-top", getPinnedColumnClassName(cell.column.id))}
                          style={getColumnSizeStyle(cell.column.getSize())}
                        />
                      );
                    }

                    if (cell.getIsAggregated()) {
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn("px-3 py-2 align-top", getPinnedColumnClassName(cell.column.id))}
                          style={getColumnSizeStyle(cell.column.getSize())}
                        />
                      );
                    }

                    return (
                      <TableCell
                        key={cell.id}
                        className={cn("px-3 py-2 align-top", getPinnedColumnClassName(cell.column.id))}
                        style={getColumnSizeStyle(cell.column.getSize())}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={table.getVisibleLeafColumns().length || columns.length} className="h-28 px-3 py-6">
                  <div className="mx-auto flex max-w-xl flex-col items-center justify-center gap-2 border border-dashed border-border/70 px-4 py-5 text-center">
                    <p className="text-sm font-medium text-foreground">{emptyStateTitle}</p>
                    <p className="text-sm text-muted-foreground">{emptyStateSummary}</p>
                    <div className="flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">표시 {filteredRowCount}건</Badge>
                      {hasActiveFilters ? <Badge variant="outline">현재 조건 적용 중</Badge> : null}
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-2 py-1 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <span>
            페이지 {currentPage} / {totalPages} · 표시 범위 {visibleRangeStart}–{visibleRangeEnd}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-xs">페이지당</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                table.setPageSize(Number(value));
                table.setPageIndex(0);
              }}
            >
              <SelectTrigger className="h-8 w-[5.5rem]" aria-label="페이지당 표시 개수">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}개
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            이전
          </Button>
          <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            다음
          </Button>
        </div>
      </div>
    </div>
  );
}
