"use client";

import { type FormEvent, type ReactNode, type TouchEvent, type WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Plus, Save, Trash2, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { ManagementKind, ManagementRow } from "@/features/management/use-management-records";
import { useManagementRecords } from "@/features/management/use-management-records";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TimePickerControl } from "@/components/ui/date-time-picker";
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
import { Textarea } from "@/components/ui/textarea";
import {
  STUDENT_STATUS_OPTIONS,
  WITHDRAWN_STUDENT_STATUS,
  normalizeStudentStatus,
} from "@/lib/student-status";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

import { ManagementDataTable } from "./management-data-table";
import { managementService } from "./management-service.js";
import { pickDefaultPeriodValue } from "./period-preferences";

type ManagementServiceClient = {
  createStudent: (record: Record<string, unknown>) => Promise<unknown>;
  updateStudent: (record: Record<string, unknown>) => Promise<unknown>;
  deleteStudent: (id: string) => Promise<unknown>;
  createClass: (record: Record<string, unknown>) => Promise<unknown>;
  updateClass: (record: Record<string, unknown>) => Promise<unknown>;
  deleteClass: (id: string) => Promise<unknown>;
  createTextbook: (record: Record<string, unknown>) => Promise<unknown>;
  updateTextbook: (record: Record<string, unknown>) => Promise<unknown>;
  deleteTextbook: (id: string) => Promise<unknown>;
  listStudents: () => Promise<RelatedRecord[]>;
  listClasses: () => Promise<RelatedRecord[]>;
  assignStudentToClass: (args: { studentId: string; classId: string; mode: "enrolled" | "waitlist" }) => Promise<unknown>;
  removeStudentFromClass: (args: { studentId: string; classId: string }) => Promise<unknown>;
  replaceClassGroupMemberships: (args: { classId: string; groupIds: string[] }) => Promise<unknown>;
};

// Contract markers: managementService.updateStudent, managementService.updateClass,
// managementService.updateTextbook, managementService.assignStudentToClass,
// managementService.removeStudentFromClass.

const service = managementService as unknown as ManagementServiceClient;

const PAGE_CONFIG = {
  students: { badgeLabel: "학년", statusLabel: "재원 상태", emptyLabel: "학생" },
  classes: { badgeLabel: "과목", statusLabel: "수업 상태", emptyLabel: "수업" },
  textbooks: { badgeLabel: "출판사", statusLabel: "구성 상태", emptyLabel: "교재" },
} satisfies Record<ManagementKind, { badgeLabel: string; statusLabel: string; emptyLabel: string }>;

type FormState = Record<string, string>;
type RelatedRecord = Record<string, unknown>;
type Field = {
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  required?: boolean;
  multiline?: boolean;
  inputMode?: "text" | "search" | "tel" | "url" | "email" | "numeric" | "decimal";
  autoComplete?: string;
};
type ClassGroupOption = { id: string; name: string; subject?: string; isDefault?: boolean };
type DeleteRequest = { rows: ManagementRow[] };
type ClassScheduleSlot = {
  day: string;
  startTime: string;
  endTime: string;
  teacher: string;
  classroom: string;
};

const CLASS_STATUS_OPTIONS = ["수강", "개강 준비", "종강"] as const;
const CLASS_SCHEDULE_DAYS = ["월", "화", "수", "목", "금", "토", "일"] as const;
const CLASS_ROSTER_GRID_CLASS_NAME = "grid gap-3 px-3 lg:grid-cols-[minmax(9rem,1.1fr)_minmax(7rem,.7fr)_minmax(5rem,.45fr)_minmax(8rem,.85fr)_minmax(8rem,.85fr)_auto] lg:items-center";
const CLASS_SCHEDULE_SLOT_GRID_CLASS_NAME = "grid gap-2 md:grid-cols-[repeat(5,minmax(0,1fr))_2.5rem]";
const CLASS_TUITION_UNIT_WON = 10000;
const CLASS_DETAIL_TABS = [
  { value: "basic", label: "기본" },
  { value: "students", label: "학생" },
] as const;
type ClassDetailTab = (typeof CLASS_DETAIL_TABS)[number]["value"];
const CLASS_SELECT_FIELD_NAMES = new Set([
  "status",
  "subject",
  "grade",
  "teacher",
  "classroom",
]);
const STUDENT_SCHOOL_CATEGORY_OPTIONS = ["고등", "중등", "초등"] as const;
const STUDENT_GRADE_OPTIONS_BY_CATEGORY: Record<(typeof STUDENT_SCHOOL_CATEGORY_OPTIONS)[number], string[]> = {
  고등: ["고1", "고2", "고3"],
  중등: ["중1", "중2", "중3"],
  초등: ["초1", "초2", "초3", "초4", "초5", "초6"],
};
const STUDENT_SELECT_FIELD_NAMES = new Set(["status", "school_category", "school", "grade"]);

const FORM_FIELDS: Record<ManagementKind, Field[]> = {
  students: [
    { name: "name", label: "학생명", placeholder: "김학생", required: true, autoComplete: "off" },
    { name: "status", label: "재원 상태", placeholder: "재원" },
    { name: "uid", label: "학생 UID", placeholder: "S-001", autoComplete: "off" },
    { name: "school_category", label: "학교 구분", placeholder: "학교 구분" },
    { name: "school", label: "학교", placeholder: "학교" },
    { name: "grade", label: "학년", placeholder: "학년" },
    { name: "contact", label: "연락처", placeholder: "010-0000-0000", inputMode: "tel", autoComplete: "tel" },
    { name: "parentContact", label: "학부모 연락처", placeholder: "010-0000-0000", inputMode: "tel", autoComplete: "tel" },
    { name: "enrollDate", label: "등록일", type: "date" },
  ],
  classes: [
    { name: "name", label: "수업명", placeholder: "고2 영어 A", required: true },
    { name: "status", label: "수업 상태", placeholder: "수강" },
    { name: "subject", label: "과목", placeholder: "영어" },
    { name: "grade", label: "학년", placeholder: "고2" },
    { name: "teacher", label: "선생님", placeholder: "한지현" },
    { name: "schedule", label: "요일/시간", placeholder: "월 18:00-20:00" },
    { name: "classroom", label: "강의실", placeholder: "별5" },
    { name: "capacity", label: "정원", type: "number", placeholder: "12" },
    { name: "fee", label: "수업료", type: "number", placeholder: "320000" },
  ],
  textbooks: [
    { name: "title", label: "교재명", placeholder: "수능특강 영어", required: true },
    { name: "subject", label: "과목", placeholder: "영어" },
    { name: "publisher", label: "출판사", placeholder: "EBS" },
    { name: "price", label: "가격", type: "number", placeholder: "9500" },
    { name: "tags", label: "태그", placeholder: "수능, 독해", multiline: true },
  ],
};

function text(value: unknown) {
  return String(value || "").trim();
}

function normalizeReturnToPath(value: unknown) {
  const path = text(value);
  if (!path || path.startsWith("//") || path.includes("://")) return "";
  return path.startsWith("/admin/") ? path : "";
}

function getClassReturnPathLabel(path: string) {
  if (path.startsWith("/admin/class-schedule")) return "수업일정";
  if (path.startsWith("/admin/curriculum")) return "수업계획";
  return "이전 화면";
}

function normalizeClassStatusForForm(value: unknown) {
  const status = text(value);
  const lowerStatus = status.toLowerCase();
  if (status.includes("종강") || lowerStatus === "ended") {
    return "종강";
  }
  if (status.includes("준비") || status.includes("예정") || lowerStatus === "preparing") {
    return "개강 준비";
  }
  return "수강";
}

function splitOptionValues(value: unknown) {
  return text(value)
    .split(/[,，/]+/)
    .map((part) => part.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function uniqueTextValues(values: unknown[]) {
  const seen = new Set<string>();
  const nextValues: string[] = [];
  for (const value of values) {
    const normalized = text(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    nextValues.push(normalized);
  }
  return nextValues;
}

function getClassroomValuesByDay(value: unknown) {
  const classroomsByDay = new Map<string, string>();
  const raw = text(value);
  if (!raw) return classroomsByDay;

  for (const match of raw.matchAll(/([^,，/()]+?)\s*\(([월화수목금토일])\)/g)) {
    const classroom = text(match[1]);
    const day = text(match[2]);
    if (classroom && day) classroomsByDay.set(day, classroom);
  }
  return classroomsByDay;
}

function looksLikeClassroomAlias(value: unknown) {
  const normalized = text(value).replace(/\s+/g, "");
  return /(?:본관|별관|강의실|교실|본\d|별\d|강$|실$)/.test(normalized);
}

function getClassTuitionManwonValue(value: unknown) {
  const digits = text(value).replace(/\D/g, "");
  if (!digits) return "";
  const amount = Number(digits);
  if (!Number.isFinite(amount) || amount < 0) return "";
  return String(amount >= CLASS_TUITION_UNIT_WON ? Math.round(amount / CLASS_TUITION_UNIT_WON) : amount);
}

function ClassTuitionManwonInput({
  id,
  name,
  value,
  placeholder,
  required = false,
  disabled = false,
  autoFocus = false,
  onChange,
}: {
  id: string;
  name: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}) {
  const touchStartYRef = useRef<number | null>(null);
  const displayValue = getClassTuitionManwonValue(value);

  const commitManwon = (nextManwon: string | number) => {
    const nextAmount = Math.max(0, Number(String(nextManwon).replace(/\D/g, "")) || 0);
    onChange(nextAmount > 0 ? String(nextAmount * CLASS_TUITION_UNIT_WON) : "");
  };
  const stepManwon = (delta: number) => {
    const nextManwon = Math.max(0, (Number(displayValue) || 0) + delta);
    commitManwon(nextManwon);
  };
  const handleWheel = (event: WheelEvent<HTMLInputElement>) => {
    if (disabled || document.activeElement !== event.currentTarget || event.deltaY === 0) return;
    event.preventDefault();
    stepManwon(event.deltaY < 0 ? 1 : -1);
  };
  const handleTouchMove = (event: TouchEvent<HTMLInputElement>) => {
    if (disabled) return;
    const currentY = event.touches[0]?.clientY;
    const startY = touchStartYRef.current;
    if (typeof currentY !== "number" || typeof startY !== "number") return;
    const deltaY = startY - currentY;
    if (Math.abs(deltaY) < 18) return;
    event.preventDefault();
    stepManwon(deltaY > 0 ? 1 : -1);
    touchStartYRef.current = currentY;
  };

  return (
    <div className={cn("flex h-10 overflow-hidden rounded-md border bg-background shadow-sm", disabled && "bg-muted/30 opacity-75")}>
      <div className="relative min-w-0 flex-1">
        <Input
          id={id}
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          autoFocus={autoFocus}
          data-testid="class-tuition-manwon-input"
          value={displayValue}
          placeholder={getClassTuitionManwonValue(placeholder) || "35"}
          required={required}
          disabled={disabled}
          className="h-full rounded-none border-0 pr-12 shadow-none focus-visible:ring-0"
          onChange={(event) => {
            const nextManwon = event.target.value.replace(/\D/g, "");
            commitManwon(nextManwon);
          }}
          onWheel={handleWheel}
          onTouchStart={(event) => {
            touchStartYRef.current = event.touches[0]?.clientY ?? null;
          }}
          onTouchMove={handleTouchMove}
          onTouchEnd={() => {
            touchStartYRef.current = null;
          }}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">만원</span>
      </div>
      <div className="grid w-8 shrink-0 border-l">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="수업료 1만원 올리기"
          className="h-5 w-8 rounded-none"
          disabled={disabled}
          onClick={() => stepManwon(1)}
        >
          <ChevronUp className="size-3" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="수업료 1만원 내리기"
          className="h-5 w-8 rounded-none"
          disabled={disabled || !displayValue}
          onClick={() => stepManwon(-1)}
        >
          <ChevronDown className="size-3" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function createEmptyClassScheduleSlot(): ClassScheduleSlot {
  return { day: "", startTime: "", endTime: "", teacher: "", classroom: "" };
}

function getNextClassScheduleDay(day: string) {
  const currentIndex = CLASS_SCHEDULE_DAYS.indexOf(day as (typeof CLASS_SCHEDULE_DAYS)[number]);
  if (currentIndex < 0) return "";
  return CLASS_SCHEDULE_DAYS[(currentIndex + 1) % CLASS_SCHEDULE_DAYS.length];
}

function createNextClassScheduleSlot(slots: ClassScheduleSlot[]) {
  const source = slots[slots.length - 1] || createEmptyClassScheduleSlot();
  return { ...source, day: getNextClassScheduleDay(source.day) };
}

function parseClassScheduleSlots(scheduleValue: unknown, teacherValue: unknown, classroomValue: unknown): ClassScheduleSlot[] {
  const schedule = text(scheduleValue);
  const teachers = splitOptionValues(teacherValue);
  const classrooms = splitOptionValues(classroomValue);
  const classroomsByDay = getClassroomValuesByDay(classroomValue);
  const slots: ClassScheduleSlot[] = [];
  const schedulePattern = /([월화수목금토일])\s*(\d{1,2}:\d{2})\s*[-~–]\s*(\d{1,2}:\d{2})(?:\s*\(([^)]*)\))?/g;

  for (const match of schedule.matchAll(schedulePattern)) {
    const day = text(match[1]);
    const detailParts = text(match[4]).split(/[,，/]+/).map(text).filter(Boolean);
    const firstDetail = detailParts[0] || "";
    const firstDetailIsTeacher = firstDetail && !looksLikeClassroomAlias(firstDetail);

    slots.push({
      day,
      startTime: text(match[2]),
      endTime: text(match[3]),
      teacher: firstDetailIsTeacher ? firstDetail : teachers[slots.length] || teachers[0] || "",
      classroom: firstDetailIsTeacher
        ? detailParts.slice(1).join(", ") || classroomsByDay.get(day) || classrooms[slots.length] || classrooms[0] || ""
        : detailParts[detailParts.length - 1] || classroomsByDay.get(day) || classrooms[slots.length] || classrooms[0] || "",
    });
  }

  if (slots.length > 0) return slots;

  const day = text(schedule.match(/[월화수목금토일]/)?.[0]);
  const timeMatch = schedule.match(/(\d{1,2}:\d{2})\s*[-~–]\s*(\d{1,2}:\d{2})/);
  const fallbackSlot = {
    day,
    startTime: text(timeMatch?.[1]),
    endTime: text(timeMatch?.[2]),
    teacher: teachers[0] || "",
    classroom: classrooms[0] || "",
  };

  return Object.values(fallbackSlot).some(Boolean)
    ? [fallbackSlot]
    : [createEmptyClassScheduleSlot()];
}

function formatClassScheduleSlots(slots: ClassScheduleSlot[]) {
  const normalizedSlots = slots
    .map((slot) => ({
      day: text(slot.day),
      startTime: text(slot.startTime),
      endTime: text(slot.endTime),
      teacher: text(slot.teacher),
      classroom: text(slot.classroom),
    }))
    .filter((slot) => Object.values(slot).some(Boolean));
  const uniqueTeachers = uniqueTextValues(normalizedSlots.map((slot) => slot.teacher));
  const uniqueClassrooms = uniqueTextValues(normalizedSlots.map((slot) => slot.classroom));
  const hasSharedScheduleDetails = uniqueTeachers.length <= 1 && uniqueClassrooms.length <= 1;

  const schedule = normalizedSlots.filter((slot) => slot.day || slot.startTime || slot.endTime).map((slot) => {
    const timeRange = slot.startTime && slot.endTime
      ? `${slot.startTime}-${slot.endTime}`
      : [slot.startTime, slot.endTime].filter(Boolean).join("-");
    const summary = [slot.day, timeRange].filter(Boolean).join(" ");
    const details = hasSharedScheduleDetails ? "" : [slot.teacher, slot.classroom].filter(Boolean).join(", ");
    return [summary, details ? `(${details})` : ""].filter(Boolean).join(" ").trim();
  }).join("\n");
  const teacher = uniqueTeachers.join(", ");
  const classroom = uniqueClassrooms.length <= 1
    ? uniqueClassrooms[0] || ""
    : normalizedSlots
        .filter((slot) => slot.classroom)
        .map((slot) => slot.day ? `${slot.classroom}(${slot.day})` : slot.classroom)
        .join(", ");

  return { schedule, teacher, classroom };
}

function getClassSubjectValue(raw: Record<string, unknown> = {}) {
  return text(raw.subject);
}

function getClassTeacherValues(raw: Record<string, unknown> = {}) {
  return splitOptionValues(raw.teacher || raw.teacher_name || raw.teacherName);
}

function getClassTeacherCatalogRows(rawRows: Record<string, unknown>[]) {
  const byIdOrName = new Map<string, Record<string, unknown>>();
  for (const raw of rawRows) {
    const catalogs = Array.isArray(raw.available_teacher_catalogs)
      ? raw.available_teacher_catalogs
      : Array.isArray(raw.availableTeacherCatalogs)
        ? raw.availableTeacherCatalogs
        : [];
    for (const catalog of catalogs) {
      if (!catalog || typeof catalog !== "object") continue;
      const catalogRow = catalog as Record<string, unknown>;
      const name = text(catalogRow.name);
      const key = text(catalogRow.id) || name;
      if (!key || !name) continue;
      byIdOrName.set(key, catalogRow);
    }
  }
  return [...byIdOrName.values()];
}

function normalizeClassTeacherCatalogSubjects(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean);
  }
  return splitOptionValues(value);
}

function normalizeClassTeacherSubjectToken(value: unknown) {
  return text(value).replace(/\s+/g, "").replace(/(과목|팀)$/g, "");
}

function isClassTeacherCatalogForSubject(catalog: Record<string, unknown>, subject: string) {
  const selectedSubject = text(subject);
  if (!selectedSubject) return true;
  const subjects = normalizeClassTeacherCatalogSubjects(catalog.subjects);
  if (subjects.length === 0) return true;
  const selectedToken = normalizeClassTeacherSubjectToken(selectedSubject);
  return subjects.some((catalogSubject) => {
    const catalogToken = normalizeClassTeacherSubjectToken(catalogSubject);
    return catalogSubject === selectedSubject || catalogToken === selectedToken;
  });
}

function getClassTeacherCatalogOptionsForSubject(rawRows: Record<string, unknown>[], subject: string) {
  return getClassTeacherCatalogRows(rawRows)
    .filter((catalog) => catalog.is_visible !== false && isClassTeacherCatalogForSubject(catalog, subject))
    .sort((left, right) => Number(left.sort_order || left.sortOrder || 0) - Number(right.sort_order || right.sortOrder || 0) || text(left.name).localeCompare(text(right.name), "ko", { numeric: true }))
    .map((catalog) => text(catalog.name))
    .filter(Boolean);
}

function getClassTeacherOptionsForSubject(rawRows: Record<string, unknown>[], subject: string) {
  const selectedSubject = text(subject);
  const subjectRows = selectedSubject
    ? rawRows.filter((raw) => getClassSubjectValue(raw) === selectedSubject)
    : rawRows;
  const sourceRows = subjectRows.length > 0 ? subjectRows : rawRows;
  const catalogOptions = getClassTeacherCatalogOptionsForSubject(rawRows, selectedSubject);
  return uniqueSortedOptions(
    [
      ...catalogOptions,
      ...sourceRows.flatMap((raw) => getClassTeacherValues(raw)),
    ],
    catalogOptions,
  );
}

function getClassClassroomOptionsForSubject(rawRows: Record<string, unknown>[], subject: string) {
  const selectedSubject = text(subject);
  const subjectRows = selectedSubject
    ? rawRows.filter((raw) => getClassSubjectValue(raw) === selectedSubject)
    : rawRows;
  const sourceRows = subjectRows.length > 0 ? subjectRows : rawRows;
  return uniqueSortedOptions(
    sourceRows.flatMap((raw) => splitOptionValues(raw.classroom || raw.room)),
  );
}

function uniqueSortedOptions(values: string[], preferredOrder: string[] = []) {
  const uniqueValues = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return uniqueValues.sort((a, b) => {
    const aIndex = preferredOrder.indexOf(a);
    const bIndex = preferredOrder.indexOf(b);
    if (aIndex !== -1 || bIndex !== -1) {
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    }
    return a.localeCompare(b, "ko", { numeric: true });
  });
}

function normalizeStudentSchoolCategory(value: unknown) {
  const normalized = text(value);
  if (!normalized) return "";
  if (normalized.includes("고")) return "고등";
  if (normalized.includes("중")) return "중등";
  if (normalized.includes("초")) return "초등";
  return normalized;
}

function getStudentSchoolCategoryFromGrade(value: unknown) {
  const grade = text(value);
  if (grade.startsWith("고")) return "고등";
  if (grade.startsWith("중")) return "중등";
  if (grade.startsWith("초")) return "초등";
  return "";
}

function getStudentSchoolCategoryFromRaw(raw: Record<string, unknown>) {
  return (
    normalizeStudentSchoolCategory(
      raw.school_category ||
        raw.schoolCategory ||
        raw.school_level ||
        raw.schoolLevel ||
        raw.category,
    ) || getStudentSchoolCategoryFromGrade(raw.grade)
  );
}

function getStudentSchoolCategoryFromForm(formState: FormState) {
  return (
    normalizeStudentSchoolCategory(
      formState.school_category ||
        formState.schoolCategory ||
        formState.school_level ||
        formState.schoolLevel,
    ) || getStudentSchoolCategoryFromGrade(formState.grade)
  );
}

function getStudentSchoolOptions(rawRows: Record<string, unknown>[], category: string) {
  return uniqueSortedOptions(
    rawRows
      .filter((raw) => !category || getStudentSchoolCategoryFromRaw(raw) === category)
      .map((raw) => text(raw.school)),
  );
}

function getStudentGradeOptions(rawRows: Record<string, unknown>[], category: string) {
  const preferredGrades = category && category in STUDENT_GRADE_OPTIONS_BY_CATEGORY
    ? STUDENT_GRADE_OPTIONS_BY_CATEGORY[category as keyof typeof STUDENT_GRADE_OPTIONS_BY_CATEGORY]
    : Object.values(STUDENT_GRADE_OPTIONS_BY_CATEGORY).flat();

  return uniqueSortedOptions(
    [
      ...preferredGrades,
      ...rawRows
        .filter((raw) => !category || getStudentSchoolCategoryFromRaw(raw) === category)
        .map((raw) => text(raw.grade)),
    ],
    preferredGrades,
  );
}

function parseClassGroupIds(value: unknown) {
  const raw = text(value);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.map(text).filter(Boolean))];
    }
  } catch {
    // Older draft state may have comma-separated group IDs.
  }

  return [...new Set(raw.split(",").map(text).filter(Boolean))];
}

function stringifyClassGroupIds(ids: string[]) {
  return JSON.stringify([...new Set(ids.map(text).filter(Boolean))]);
}

function normalizeClassGroupOptions(value: unknown): ClassGroupOption[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): ClassGroupOption | null => {
      if (item && typeof item === "object") {
        const group = item as Record<string, unknown>;
        const id = text(group.id);
        const name = text(group.name) || id;
        return id || name
          ? {
              id: id || name,
              name,
              subject: text(group.subject),
              isDefault: group.is_default === true || group.isDefault === true,
            }
          : null;
      }

      const name = text(item);
      return name ? { id: name, name } : null;
    })
    .filter((item): item is ClassGroupOption => Boolean(item));
}

function getClassGroupIdsFromRaw(raw: Record<string, unknown>) {
  const explicit = Array.isArray(raw.classGroupIds)
    ? raw.classGroupIds
    : Array.isArray(raw.class_group_ids)
      ? raw.class_group_ids
      : [];
  const explicitIds = explicit.map(text).filter(Boolean);
  if (explicitIds.length > 0) {
    return [...new Set(explicitIds)];
  }

  const assignedGroupIds = normalizeClassGroupOptions(raw.classGroups || raw.class_groups).map((group) => group.id);
  if (assignedGroupIds.length > 0) {
    return [...new Set(assignedGroupIds)];
  }

  const legacyLabel = [getClassAcademicYearOption(raw), getClassTermOption(raw)].filter(Boolean).join(" ").trim();
  if (!legacyLabel) {
    return [];
  }

  return [
    ...new Set(
      normalizeClassGroupOptions(raw.availableClassGroups || raw.available_class_groups)
        .filter((group) => group.id === legacyLabel || group.name === legacyLabel)
        .map((group) => group.id),
    ),
  ];
}

function getClassGroupOptionsFromRows(rows: ManagementRow[]) {
  const byId = new Map<string, ClassGroupOption>();
  for (const row of rows) {
    const raw = (row.raw || {}) as Record<string, unknown>;
    for (const group of [
      ...normalizeClassGroupOptions(raw.availableClassGroups || raw.available_class_groups),
      ...normalizeClassGroupOptions(raw.classGroups || raw.class_groups),
    ]) {
      if (!byId.has(group.id)) {
        byId.set(group.id, group);
      }
    }
  }

  return [...byId.values()].sort(
    (left, right) =>
      text(left.subject).localeCompare(text(right.subject), "ko") ||
      left.name.localeCompare(right.name, "ko", { numeric: true }),
  );
}

function getDefaultClassGroupIdsForCreate(classGroupOptions: ClassGroupOption[]) {
  const defaultGroupId = pickDefaultPeriodValue(
    classGroupOptions.map((group) => ({
      value: group.id,
      label: group.name,
      aliases: [group.id, group.name],
      isDefault: group.isDefault,
    })),
  );

  return defaultGroupId ? stringifyClassGroupIds([defaultGroupId]) : "";
}

function getClassAcademicYearOption(record: Record<string, unknown>) {
  const explicitYear = text(
    record.academic_year ||
      record.academicYear ||
      record.year ||
      record.term_year ||
      record.termYear,
  );
  if (explicitYear) {
    return explicitYear;
  }

  const dateText = text(
    record.start_date ||
      record.startDate ||
      record.end_date ||
      record.endDate ||
      record.created_at ||
      record.createdAt,
  );
  return dateText.match(/\d{4}/)?.[0] || "";
}

function getClassTermOption(record: Record<string, unknown>) {
  return text(
    record.term ||
      record.term_name ||
      record.termName ||
      record.semester ||
      record.academic_term ||
      record.academicTerm ||
      record.period,
  );
}

function getClassPeriodLabel(row: ManagementRow) {
  const raw = (row.raw || {}) as Record<string, unknown>;
  const rawGroupNames = Array.isArray(raw.class_group_names || raw.classGroupNames)
    ? (raw.class_group_names || raw.classGroupNames) as unknown[]
    : [];
  const groupNames = rawGroupNames.map(text).filter(Boolean);
  const classGroups = normalizeClassGroupOptions(raw.classGroups || raw.class_groups);
  const periodNames = groupNames.length > 0 ? groupNames : classGroups.map((group) => group.name).filter(Boolean);

  if (periodNames.length === 1) {
    return periodNames[0];
  }
  if (periodNames.length > 1) {
    return `${periodNames[0]} 외 ${periodNames.length - 1}개`;
  }

  return [getClassAcademicYearOption(raw), getClassTermOption(raw)].filter(Boolean).join(" ").trim();
}

function getLabel(kind: ManagementKind) {
  if (kind === "students") return "학생 등록";
  if (kind === "classes") return "수업 등록";
  return "교재 등록";
}

function normalizeClassDetailTab(value: unknown): ClassDetailTab {
  const tab = text(value);
  return CLASS_DETAIL_TABS.some((item) => item.value === tab) ? (tab as ClassDetailTab) : "basic";
}

function scrollClassDetailTargetIntoView(target: HTMLElement) {
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  const dialog = target.closest('[role="dialog"]') as HTMLElement | null;
  if (!dialog) return;

  const dialogRect = dialog.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const targetOffset = targetRect.top - dialogRect.top - Math.max((dialogRect.height - targetRect.height) / 2, 0);
  dialog.scrollTop += targetOffset;
}

function initialForm(kind: ManagementKind, row?: ManagementRow | null): FormState {
  const raw = (row?.raw || {}) as Record<string, unknown>;
  const valueFor = (name: string) => {
    if (name === "parentContact") return text(raw.parent_contact || raw.parentContact);
    if (name === "enrollDate") return text(raw.enroll_date || raw.enrollDate).slice(0, 10);
    if (name === "name") return text(raw.name || raw.class_name || raw.className || row?.title);
    if (name === "school_category") return getStudentSchoolCategoryFromRaw(raw);
    if (name === "status") {
      return kind === "students"
        ? normalizeStudentStatus(raw.status || row?.status || row?.statusValue)
        : normalizeClassStatusForForm(raw.status || row?.status || row?.statusValue);
    }
    if (name === "classroom") return text(raw.classroom || raw.room);
    if (name === "fee") return text(raw.fee || raw.tuition);
    if (name === "tags") return Array.isArray(raw.tags) ? raw.tags.join(", ") : text(raw.tags);
    return text(raw[name]);
  };
  const nextForm = Object.fromEntries(FORM_FIELDS[kind].map((field) => [field.name, valueFor(field.name)]));
  if (kind === "classes") {
    nextForm.classGroupIds = stringifyClassGroupIds(getClassGroupIdsFromRaw(raw));
  }
  return nextForm;
}

function compact(formState: FormState, kind: ManagementKind, row?: ManagementRow | null): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ...(row?.raw || {}),
    id: row?.id,
    ...Object.fromEntries(Object.entries(formState).map(([key, value]) => [key, value.trim()])),
  };

  delete payload.classGroupIds;
  if (payload.parentContact) payload.parent_contact = payload.parentContact;
  if (payload.classroom) payload.room = payload.classroom;
  if (payload.name && kind === "classes") {
    payload.class_name = payload.name;
    payload.className = payload.name;
  }
  if (payload.fee) payload.tuition = payload.fee;

  return payload;
}

function getSavedClassId(result: unknown, fallback: unknown) {
  if (result && typeof result === "object") {
    const saved = result as Record<string, unknown>;
    const id = text(saved.id);
    if (id) return id;
  }
  return text(fallback);
}

function isUuidLike(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value));
}

function getMissingRelatedTitle(kind: ManagementKind) {
  if (kind === "classes") return "학생 정보 확인 필요";
  if (kind === "students") return "수업 정보 확인 필요";
  return "연결 정보 확인 필요";
}

function relatedTitle(record: RelatedRecord, fallbackLabel = "연결 정보 확인 필요") {
  const title = text(record.name || record.class_name || record.className || record.title);
  if (title && !isUuidLike(title)) return title;

  const id = text(record.id);
  return id && !isUuidLike(id) ? id : fallbackLabel;
}

function normalizeRelatedRecordList(value: unknown): RelatedRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (item && typeof item === "object") return item as RelatedRecord;
      const id = text(item);
      return id ? { id } : null;
    })
    .filter((item): item is RelatedRecord => Boolean(item && text(item.id)));
}

function getEmbeddedRelatedRecords(kind: ManagementKind, row?: ManagementRow | null) {
  if (!row || kind !== "classes") return [];
  return getClassStudentSummaries(row);
}

function getClassStudentSummaries(row: ManagementRow) {
  const raw = (row.raw || {}) as Record<string, unknown>;
  return [
    ...normalizeRelatedRecordList(raw.registered_students || raw.registeredStudents),
    ...normalizeRelatedRecordList(raw.waitlist_students || raw.waitlistStudents),
  ];
}

function formatSchoolGradeLabel(schoolValue: unknown, gradeValue: unknown) {
  const school = text(schoolValue);
  const grade = text(gradeValue);
  const normalizedGrade = school && grade.startsWith(school.slice(-1)) ? grade.slice(1) : grade;
  return [school, normalizedGrade].filter(Boolean).join("");
}

function relatedMeta(record?: RelatedRecord) {
  if (!record) return "";
  const schoolGrade = formatSchoolGradeLabel(record.school, record.grade);
  if (schoolGrade) return schoolGrade;

  return [text(record.subject), text(record.schedule)]
    .filter(Boolean)
    .join(" · ");
}

function getStudentSchoolValue(record?: RelatedRecord) {
  if (!record) return "";
  return text(record.school);
}

function getStudentGradeValue(record?: RelatedRecord) {
  if (!record) return "";
  return text(record.grade);
}

function idList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function addIdToList(value: unknown, id: string) {
  const next = idList(value);
  return next.includes(id) ? next : [...next, id];
}

function removeIdFromList(value: unknown, id: string) {
  return idList(value).filter((item) => item !== id);
}

function updateRelationOnRow(row: ManagementRow, kind: ManagementKind, id: string, mode: "enrolled" | "waitlist" | "removed") {
  const raw = { ...(row.raw || {}) } as Record<string, unknown>;

  if (kind === "students") {
    const enrolledClassIds = mode === "enrolled" ? addIdToList(raw.class_ids || raw.classIds, id) : removeIdFromList(raw.class_ids || raw.classIds, id);
    const waitlistClassIds = mode === "waitlist" ? addIdToList(raw.waitlist_class_ids || raw.waitlistClassIds, id) : removeIdFromList(raw.waitlist_class_ids || raw.waitlistClassIds, id);
    raw.class_ids = enrolledClassIds;
    raw.classIds = enrolledClassIds;
    raw.waitlist_class_ids = waitlistClassIds;
    raw.waitlistClassIds = waitlistClassIds;
  }

  if (kind === "classes") {
    const enrolledStudentIds = mode === "enrolled" ? addIdToList(raw.student_ids || raw.studentIds, id) : removeIdFromList(raw.student_ids || raw.studentIds, id);
    const waitlistStudentIds = mode === "waitlist"
      ? addIdToList(raw.waitlist_student_ids || raw.waitlistStudentIds || raw.waitlist_ids || raw.waitlistIds, id)
      : removeIdFromList(raw.waitlist_student_ids || raw.waitlistStudentIds || raw.waitlist_ids || raw.waitlistIds, id);
    raw.student_ids = enrolledStudentIds;
    raw.studentIds = enrolledStudentIds;
    raw.waitlist_student_ids = waitlistStudentIds;
    raw.waitlistStudentIds = waitlistStudentIds;
    raw.waitlist_ids = waitlistStudentIds;
    raw.waitlistIds = waitlistStudentIds;
  }

  return { ...row, raw };
}

function getStudentEnrolledClassIds(row: ManagementRow) {
  const raw = (row.raw || {}) as Record<string, unknown>;
  return idList(raw.class_ids || raw.classIds);
}

function getStudentWaitlistClassIds(row: ManagementRow) {
  const raw = (row.raw || {}) as Record<string, unknown>;
  return idList(raw.waitlist_class_ids || raw.waitlistClassIds);
}

function getClassEnrolledStudentIds(row: ManagementRow) {
  const raw = (row.raw || {}) as Record<string, unknown>;
  return idList(raw.student_ids || raw.studentIds);
}

function getClassWaitlistStudentIds(row: ManagementRow) {
  const raw = (row.raw || {}) as Record<string, unknown>;
  return idList(raw.waitlist_student_ids || raw.waitlistStudentIds || raw.waitlist_ids || raw.waitlistIds);
}

function getClassTextbookCount(row: ManagementRow) {
  const raw = (row.raw || {}) as Record<string, unknown>;
  const explicitCount = Number(raw.textbook_count || raw.textbookCount || row.metrics.textbookCount || 0);
  if (Number.isFinite(explicitCount) && explicitCount > 0) {
    return explicitCount;
  }
  return idList(raw.textbook_ids || raw.textbookIds).length;
}

function getClassSessionCount(row: ManagementRow) {
  const raw = (row.raw || {}) as Record<string, unknown>;
  const value = Number(raw.total_sessions || raw.totalSessions || 0);
  return Number.isFinite(value) ? value : 0;
}

function getClassDelayedProgressCount(row: ManagementRow) {
  const raw = (row.raw || {}) as Record<string, unknown>;
  const value = Number(raw.delayed_progress_sessions || raw.delayedProgressSessions || 0);
  return Number.isFinite(value) ? value : 0;
}

function normalizeHistoryRows(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : [];
}

function getStudentClassHistory(row: ManagementRow) {
  const raw = (row.raw || {}) as Record<string, unknown>;
  return normalizeHistoryRows(raw.classHistory || raw.class_history);
}

function getStudentTextbookHistory(row: ManagementRow) {
  const raw = (row.raw || {}) as Record<string, unknown>;
  return normalizeHistoryRows(raw.textbookHistory || raw.textbook_history);
}

function formatHistoryDate(value: unknown) {
  const normalized = text(value);
  if (!normalized) {
    return "-";
  }
  return normalized.replace("T", " ").slice(0, 16);
}

function getStudentContactValue(record: RelatedRecord | undefined, kind: "student" | "parent") {
  if (!record) return "";
  return kind === "parent"
    ? text(record.parent_contact || record.parentContact || record.guardian_contact || record.guardianContact)
    : text(record.contact || record.phone || record.student_contact || record.studentContact);
}

function renderStudentTimelineList(
  label: string,
  items: Record<string, unknown>[],
  renderItem: (item: Record<string, unknown>, index: number) => ReactNode,
) {
  return (
    <section className="overflow-hidden rounded-md border bg-background">
      <div className="flex h-10 items-center justify-between border-b px-3">
        <div className="text-sm font-semibold">{label}</div>
        <Badge variant="secondary" className="h-6 rounded-full px-2">
          {items.length}건
        </Badge>
      </div>
      {items.length > 0 ? (
        <div className="divide-y">
          {items.slice(0, 8).map(renderItem)}
        </div>
      ) : (
        <div className="px-3 py-5 text-sm text-muted-foreground">이력이 없습니다</div>
      )}
    </section>
  );
}

function renderStudentHistoryPanel(row: ManagementRow) {
  const classHistory = getStudentClassHistory(row);
  const textbookHistory = getStudentTextbookHistory(row);

  return (
    <section className="space-y-3 border-t pt-4">
      <div className="text-sm font-semibold">수업·교재 이력</div>
      <div className="grid gap-3 lg:grid-cols-2">
        {renderStudentTimelineList("수업 이력", classHistory, (item, index) => (
          <div key={text(item.id) || `class-history-${index}`} className="grid gap-0.5 px-3 py-2.5">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{text(item.className || item.class_name) || "-"}</span>
              <Badge variant="outline" className="shrink-0">{text(item.label || item.action) || "-"}</Badge>
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {[text(item.subject), text(item.teacher), formatHistoryDate(item.changedAt || item.changed_at)]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        ))}
        {renderStudentTimelineList("교재 이력", textbookHistory, (item, index) => (
          <div key={text(item.id) || `textbook-history-${index}`} className="grid gap-0.5 px-3 py-2.5">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{text(item.title) || "-"}</span>
              <Badge variant="outline" className="shrink-0">{text(item.quantity) || "0"}권</Badge>
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {[text(item.className || item.class_name), text(item.status), formatHistoryDate(item.issuedAt || item.issued_at || item.createdAt || item.created_at)]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function detailMetric(label: string, value: string | number, tone = "default") {
  return { label, value, tone };
}

function getDetailMetrics(kind: ManagementKind, row: ManagementRow) {
  const raw = row.raw || {};
  if (kind === "classes") {
    const enrolledCount = getClassEnrolledStudentIds(row).length;
    const waitlistCount = getClassWaitlistStudentIds(row).length;
    const capacity = Number(raw.capacity || row.metrics.capacity || 0);
    const textbookCount = getClassTextbookCount(row);
    const sessionCount = getClassSessionCount(row);
    const delayedProgressCount = getClassDelayedProgressCount(row);
    return [
      detailMetric("수강생", enrolledCount),
      detailMetric("대기자", waitlistCount),
      detailMetric("정원", capacity > 0 ? `${enrolledCount}/${capacity}` : "-"),
      detailMetric("교재 연결", `${textbookCount}권`),
      detailMetric("회차", sessionCount > 0 ? `${sessionCount}회` : "-"),
      detailMetric("미배정", delayedProgressCount > 0 ? `${delayedProgressCount}회` : "0회"),
    ];
  }

  if (kind === "students") {
    return [
      detailMetric("재원 상태", normalizeStudentStatus(raw.status || row.status)),
      detailMetric("수강 수업", getStudentEnrolledClassIds(row).length),
      detailMetric("대기 수업", getStudentWaitlistClassIds(row).length),
      detailMetric("교재 이력", getStudentTextbookHistory(row).length),
    ];
  }

  return [
    detailMetric("과목", text(raw.subject) || "-"),
    detailMetric("출판사", text(raw.publisher) || "-"),
    detailMetric("가격", text(raw.price) || "-"),
    detailMetric("태그", Array.isArray(raw.tags) ? raw.tags.length : 0),
  ];
}

function getSaveErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const details = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    return [details.message, details.details, details.hint, details.code]
      .map((value) => text(value))
      .filter(Boolean)
      .join(" · ") || "등록 저장 중 오류가 발생했습니다.";
  }
  return text(error) || "등록 저장 중 오류가 발생했습니다.";
}

function getSaveErrorStatusLabel(message: string) {
  return `저장 실패 · 기존 데이터 유지 · ${message}`;
}

function FieldClearButton({
  "aria-label": ariaLabel,
  disabled = false,
  onClick,
  show,
}: {
  "aria-label": string;
  disabled?: boolean;
  onClick: () => void;
  show: boolean;
}) {
  if (!show) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="absolute right-8 top-1/2 z-10 size-6 -translate-y-1/2 rounded-full bg-background/90 text-muted-foreground hover:text-foreground"
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      <X className="size-3.5" aria-hidden="true" />
    </Button>
  );
}

export function ManagementPage({ kind }: { kind: ManagementKind }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { canManageAll } = useAuth();
  const config = PAGE_CONFIG[kind];
  const { rows, stats, loading, error, refresh } = useManagementRecords(kind);
  const canMutateRows = canManageAll;
  const [dialogMode, setDialogMode] = useState<"create" | "detail" | null>(null);
  const [selectedRow, setSelectedRow] = useState<ManagementRow | null>(null);
  const [form, setForm] = useState<FormState>(() => initialForm(kind));
  const [classScheduleSlots, setClassScheduleSlots] = useState<ClassScheduleSlot[]>([]);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [relatedRows, setRelatedRows] = useState<RelatedRecord[]>([]);
  const [targetId, setTargetId] = useState("");
  const [pendingRelationMode, setPendingRelationMode] = useState<"enrolled" | "waitlist" | null>(null);
  const [pendingClassStudentDetailId, setPendingClassStudentDetailId] = useState("");
  const [relationPickerOpen, setRelationPickerOpen] = useState(false);
  const [detailRowQuery, setDetailRowQuery] = useState("");
  const [relationQuery, setRelationQuery] = useState("");
  const classDetailRouteClearPendingRef = useRef(false);
  const studentDetailRouteClearPendingRef = useRef(false);
  const requestedClassId = kind === "classes" ? text(searchParams.get("classId")) : "";
  const requestedStudentId = kind === "students" ? text(searchParams.get("studentId")) : "";
  const requestedStudentReturnPath = kind === "students" ? normalizeReturnToPath(searchParams.get("returnTo")) : "";
  const requestedClassDetailTabParam = kind === "classes" ? text(searchParams.get("tab")) : "";
  const requestedClassDetailTab = normalizeClassDetailTab(requestedClassDetailTabParam);
  const requestedClassDetailSection = kind === "classes" ? text(searchParams.get("section")) : "";
  const requestedClassDetailSessionId = kind === "classes" ? text(searchParams.get("sessionId")) : "";
  const requestedClassDetailStudentId = kind === "classes" ? text(searchParams.get("studentId")) : "";
  const requestedClassReturnPath = kind === "classes" ? normalizeReturnToPath(searchParams.get("returnTo")) : "";

  const createLabel = getLabel(kind);
  const isCreate = dialogMode === "create";
  const isDetail = dialogMode === "detail";
  const dialogTitle = isCreate ? createLabel : `${selectedRow?.title || ""} 상세 정보`;
  const relatedRecordsById = useMemo(
    () => {
      const records = new Map<string, RelatedRecord>();
      for (const record of getEmbeddedRelatedRecords(kind, selectedRow)) {
        const id = text(record.id);
        if (id) records.set(id, record);
      }
      for (const record of relatedRows) {
        const id = text(record.id);
        if (id) records.set(id, { ...(records.get(id) || {}), ...record });
      }
      return records;
    },
    [kind, relatedRows, selectedRow],
  );

  const relationLabel = kind === "students" ? "수업" : "학생";
  const selectedRelationIdSet = useMemo(() => {
    if (!selectedRow || kind === "textbooks") return new Set<string>();
    const ids = kind === "students"
      ? [...getStudentEnrolledClassIds(selectedRow), ...getStudentWaitlistClassIds(selectedRow)]
      : [...getClassEnrolledStudentIds(selectedRow), ...getClassWaitlistStudentIds(selectedRow)];
    return new Set(ids);
  }, [kind, selectedRow]);
  const availableRelatedRows = useMemo(
    () => relatedRows.filter((record) => {
      const id = text(record.id);
      return id && !selectedRelationIdSet.has(id);
    }),
    [relatedRows, selectedRelationIdSet],
  );
  const filteredAvailableRelatedRows = useMemo(() => {
    const query = relationQuery.trim().toLowerCase();
    if (!query) return availableRelatedRows;
    return availableRelatedRows.filter((record) =>
      `${relatedTitle(record)} ${relatedMeta(record)}`.toLowerCase().includes(query),
    );
  }, [availableRelatedRows, relationQuery]);
  const detailSearchLabel = kind === "classes" ? "수업명 검색" : kind === "students" ? "학생명 검색" : "교재명 검색";
  const detailSearchMatches = useMemo(() => {
    const query = detailRowQuery.trim().toLowerCase();
    if (!query) return [];
    return rows
      .filter((row) => row.id !== selectedRow?.id)
      .filter((row) => `${row.title} ${row.subtitle} ${row.metaSummary} ${row.searchText}`.toLowerCase().includes(query))
      .slice(0, 8);
  }, [detailRowQuery, rows, selectedRow?.id]);
  const selectedClassSubject = kind === "classes" ? text(form.subject) : "";
  const classSelectOptions = useMemo(() => {
    if (kind !== "classes") {
      return {} as Record<string, string[]>;
    }

    const rawRows = rows.map((row) => (row.raw || {}) as Record<string, unknown>);

    return {
      status: [...CLASS_STATUS_OPTIONS],
      subject: uniqueSortedOptions(rawRows.map((raw) => text(raw.subject)), ["영어", "수학"]),
      grade: uniqueSortedOptions(rawRows.map((raw) => text(raw.grade))),
      teacher: getClassTeacherOptionsForSubject(rawRows, selectedClassSubject),
      classroom: getClassClassroomOptionsForSubject(rawRows, selectedClassSubject),
    } satisfies Record<string, string[]>;
  }, [kind, rows, selectedClassSubject]);
  const studentSchoolCategory = getStudentSchoolCategoryFromForm(form);
  const studentSelectOptions = useMemo(() => {
    if (kind !== "students") {
      return {} as Record<string, string[]>;
    }

    const rawRows = rows.map((row) => (row.raw || {}) as Record<string, unknown>);

    return {
      status: [...STUDENT_STATUS_OPTIONS],
      school_category: [...STUDENT_SCHOOL_CATEGORY_OPTIONS],
      school: getStudentSchoolOptions(rawRows, studentSchoolCategory),
      grade: getStudentGradeOptions(rawRows, studentSchoolCategory),
    } satisfies Record<string, string[]>;
  }, [kind, rows, studentSchoolCategory]);
  const classGroupOptions = useMemo(
    () => (kind === "classes" ? getClassGroupOptionsFromRows(rows) : []),
    [kind, rows],
  );
  const defaultClassGroupIdsForCreate = useMemo(
    () => (kind === "classes" ? getDefaultClassGroupIdsForCreate(classGroupOptions) : ""),
    [classGroupOptions, kind],
  );
  const writeClassDetailRoute = useCallback(
    (
      classId: string,
      tab: ClassDetailTab,
      options: { studentId?: string } = {},
    ) => {
      if (kind !== "classes") return;
      const params = new URLSearchParams(searchParams.toString());
      params.set("classId", classId);
      params.set("tab", tab);
      params.delete("section");
      params.delete("sessionId");
      if (options.studentId) {
        params.set("studentId", options.studentId);
      } else {
        params.delete("studentId");
      }
      const nextQuery = params.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    },
    [kind, pathname, router, searchParams],
  );
  const clearClassDetailRoute = useCallback(() => {
    if (kind !== "classes") return;
    classDetailRouteClearPendingRef.current = true;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("classId");
    params.delete("tab");
    params.delete("section");
    params.delete("sessionId");
    params.delete("studentId");
    params.delete("returnTo");
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [kind, pathname, router, searchParams]);
  useEffect(() => {
    if (kind === "classes" && !requestedClassId) {
      classDetailRouteClearPendingRef.current = false;
    }
  }, [kind, requestedClassId]);
  useEffect(() => {
    const shouldNormalizeTab =
      requestedClassDetailTabParam && requestedClassDetailTabParam !== requestedClassDetailTab;
    if (
      kind !== "classes" ||
      (!shouldNormalizeTab && !requestedClassDetailSection && !requestedClassDetailSessionId)
    ) {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    if (shouldNormalizeTab) {
      params.set("tab", requestedClassDetailTab);
    }
    params.delete("section");
    params.delete("sessionId");
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [
    kind,
    pathname,
    requestedClassDetailSection,
    requestedClassDetailSessionId,
    requestedClassDetailTab,
    requestedClassDetailTabParam,
    router,
    searchParams,
  ]);
  const writeStudentDetailRoute = useCallback((studentId: string) => {
    if (kind !== "students") return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("studentId", studentId);
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [kind, pathname, router, searchParams]);
  const clearStudentDetailRoute = useCallback(() => {
    if (kind !== "students") return;
    studentDetailRouteClearPendingRef.current = true;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("studentId");
    params.delete("returnTo");
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [kind, pathname, router, searchParams]);
  useEffect(() => {
    if (kind === "students" && !requestedStudentId) {
      studentDetailRouteClearPendingRef.current = false;
    }
  }, [kind, requestedStudentId]);
  const resolveRelatedRecord = (id: string) => relatedRecordsById.get(id);
  const resolveRelatedTitle = (id: string) => {
    const fallbackTitle = getMissingRelatedTitle(kind);
    const record = resolveRelatedRecord(id);
    if (record) return relatedTitle(record, fallbackTitle);
    return isUuidLike(id) ? fallbackTitle : id;
  };
  const handleClassStudentDetailOpen = (studentId: string) => {
    if (!selectedRow || kind !== "classes") return;
    const targetStudentId = text(studentId);
    if (!targetStudentId) return;
    const params = new URLSearchParams();
    params.set("studentId", targetStudentId);
    params.set("returnTo", buildClassDetailReturnPath("students", { studentId: targetStudentId }));
    router.push(`/admin/students?${params.toString()}`);
  };
  const confirmClassStudentDetailOpen = () => {
    const targetStudentId = pendingClassStudentDetailId;
    setPendingClassStudentDetailId("");
    handleClassStudentDetailOpen(targetStudentId);
  };
  const buildStudentDetailReturnPath = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (selectedRow?.id) {
      params.set("studentId", selectedRow.id);
    }
    return `/admin/students?${params.toString()}`;
  };
  const handleStudentClassDetailOpen = (classId: string, tab: ClassDetailTab = "students") => {
    if (!selectedRow || kind !== "students") return;
    const targetClassId = text(classId);
    if (!targetClassId) return;
    const params = new URLSearchParams();
    params.set("classId", targetClassId);
    params.set("tab", tab);
    params.set("studentId", selectedRow.id);
    params.set("returnTo", buildStudentDetailReturnPath());
    router.push(`/admin/classes?${params.toString()}`);
  };
  const renderRelationList = (label: string, ids: string[], modeLabel: "수강" | "대기") => (
    <section
      data-testid={kind === "classes" ? (modeLabel === "수강" ? "class-enrolled-student-roster" : "class-waitlist-student-roster") : undefined}
      className="overflow-hidden rounded-md border bg-background"
    >
      <div className="flex h-10 items-center justify-between border-b px-3">
        <div className="text-sm font-semibold">{label}</div>
        <Badge variant="secondary" className="h-6 rounded-full px-2">
          {ids.length}{kind === "students" ? "개" : "명"}
        </Badge>
      </div>
      {ids.length > 0 ? (
        <div className="divide-y">
          {kind === "classes" ? (
            <>
              <div className={cn("hidden bg-muted/25 py-2 text-xs font-medium text-muted-foreground lg:grid", CLASS_ROSTER_GRID_CLASS_NAME)}>
                <div>학생</div>
                <div>학교</div>
                <div>학년</div>
                <div>학생 연락처</div>
                <div>학부모 연락처</div>
                <div className="text-right">관리</div>
              </div>
              {ids.map((id) => {
                const record = resolveRelatedRecord(id);
                const school = getStudentSchoolValue(record);
                const grade = getStudentGradeValue(record);
                const studentContact = getStudentContactValue(record, "student");
                const parentContact = getStudentContactValue(record, "parent");
                const isFocusedRosterStudent = requestedClassDetailStudentId === id;

                return (
                  <div
                    key={`${modeLabel}-${id}`}
                    id={`class-roster-student-${id}`}
                    data-testid="class-roster-student-row"
                    data-class-roster-student-id={id}
                    data-class-roster-focused={isFocusedRosterStudent ? "true" : undefined}
                    className={cn(
                      CLASS_ROSTER_GRID_CLASS_NAME,
                      "py-3",
                      isFocusedRosterStudent && "bg-primary/5 ring-1 ring-inset ring-primary/30",
	                    )}
	                  >
	                    <div className="min-w-0">
	                      <button
	                        type="button"
	                        data-testid="class-roster-student-name-link"
	                        className="block max-w-full truncate text-left text-sm font-semibold underline-offset-2 transition hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
	                        onClick={() => setPendingClassStudentDetailId(id)}
	                      >
	                        {resolveRelatedTitle(id)}
	                      </button>
	                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground lg:hidden">학교</div>
                      <div className="truncate text-sm font-medium">{school || "-"}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground lg:hidden">학년</div>
                      <div className="truncate text-sm font-medium">{grade || "-"}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground lg:hidden">학생 연락처</div>
                      <div className="truncate text-sm font-medium">{studentContact || "-"}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground lg:hidden">학부모 연락처</div>
                      <div className="truncate text-sm font-medium">{parentContact || "-"}</div>
                    </div>
	                    <div className="flex flex-wrap justify-end gap-1">
	                      {modeLabel !== "수강" ? (
	                        <Button
	                          type="button"
	                          variant="outline"
	                          size="sm"
	                          className="h-7 px-2"
	                          onClick={() => handleRelationModeChange(id, "enrolled")}
	                          disabled={saving || !canMutateRows}
	                        >
	                          등록 전환
	                        </Button>
	                      ) : null}
	                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-destructive hover:text-destructive"
                        onClick={() => handleRelationRemove(selectedRow?.id || "", id)}
                        disabled={saving || !canMutateRows}
                        aria-label={`${resolveRelatedTitle(id)} ${modeLabel} 해제`}
                      >
                        해제
                      </Button>
                    </div>
                  </div>
                );
              })}
            </>
          ) : ids.map((id) => (
            <div key={`${modeLabel}-${id}`} className="grid gap-3 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{resolveRelatedTitle(id)}</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">{relatedMeta(resolveRelatedRecord(id)) || modeLabel}</div>
              </div>
              <div className="flex flex-wrap justify-end gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
                  data-testid="student-class-official-link"
                  onClick={() => handleStudentClassDetailOpen(id, "students")}
                >
                  학생 현황
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => handleRelationModeChange(id, modeLabel === "수강" ? "waitlist" : "enrolled")}
                  disabled={saving || !canMutateRows}
                >
                  {modeLabel === "수강" ? "대기로" : "등록"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-destructive hover:text-destructive"
                  onClick={() => handleRelationRemove(id, selectedRow?.id || "")}
                  disabled={saving || !canMutateRows}
                  aria-label={`${resolveRelatedTitle(id)} ${modeLabel} 해제`}
                >
                  해제
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-3 py-5 text-sm text-muted-foreground">
          {label} 없음
        </div>
      )}
    </section>
  );
  const getEditableFieldOptions = (fieldName: string, value: string) => {
    if (kind === "students" && STUDENT_SELECT_FIELD_NAMES.has(fieldName)) {
      const options = studentSelectOptions[fieldName] || [];
      return value && !options.includes(value) ? [value, ...options] : options;
    }

    if (kind === "classes" && CLASS_SELECT_FIELD_NAMES.has(fieldName)) {
      const options = classSelectOptions[fieldName] || [];
      return value && !options.includes(value) ? [value, ...options] : options;
    }

    return [];
  };

  const handleEditableFieldChange = (fieldName: string, nextValue: string) => {
    const normalizedValue = nextValue === "__none__" ? "" : nextValue;
    if (kind === "classes" && fieldName === "subject") {
      const rawRows = rows.map((row) => (row.raw || {}) as Record<string, unknown>);
      const teacherOptions = getClassTeacherOptionsForSubject(rawRows, normalizedValue);
      const classroomOptions = getClassClassroomOptionsForSubject(rawRows, normalizedValue);
      const nextSlots = (classScheduleSlots.length > 0 ? classScheduleSlots : parseClassScheduleSlots(form.schedule, form.teacher, form.classroom)).map((slot) => ({
        ...slot,
        teacher: slot.teacher && teacherOptions.length > 0 && !teacherOptions.includes(slot.teacher) ? "" : slot.teacher,
        classroom: slot.classroom && classroomOptions.length > 0 && !classroomOptions.includes(slot.classroom) ? "" : slot.classroom,
      }));
      const formattedSlots = formatClassScheduleSlots(nextSlots);
      setClassScheduleSlots(nextSlots);
      setForm((current) => {
        const next = { ...current, [fieldName]: normalizedValue, ...formattedSlots };
        if (next.teacher && teacherOptions.length > 0 && !teacherOptions.includes(next.teacher)) {
          next.teacher = "";
        }
        if (next.classroom && classroomOptions.length > 0 && !classroomOptions.includes(next.classroom)) {
          next.classroom = "";
        }
        return next;
      });
      return;
    }

    setForm((current) => {
      const next = { ...current, [fieldName]: normalizedValue };

      if (kind === "students") {
        if (fieldName === "school_category") {
          const category = normalizeStudentSchoolCategory(normalizedValue);
          const rawRows = rows.map((row) => (row.raw || {}) as Record<string, unknown>);
          const schoolOptions = getStudentSchoolOptions(rawRows, category);
          const gradeOptions = getStudentGradeOptions(rawRows, category);

          if (next.school && category && !schoolOptions.includes(next.school)) {
            next.school = "";
          }
          if (next.grade && category && !gradeOptions.includes(next.grade)) {
            next.grade = "";
          }
        }

        if (fieldName === "grade" && !normalizeStudentSchoolCategory(next.school_category)) {
          const category = getStudentSchoolCategoryFromGrade(normalizedValue);
          if (category) {
            next.school_category = category;
          }
        }
      }

      return next;
    });
  };

  const getClassScheduleSlotsFromForm = () => classScheduleSlots.length > 0
    ? classScheduleSlots
    : parseClassScheduleSlots(form.schedule, form.teacher, form.classroom);
  const syncClassScheduleSlots = (slots: ClassScheduleSlot[]) => {
    const nextSlots = slots.length > 0 ? slots : [createEmptyClassScheduleSlot()];
    const formatted = formatClassScheduleSlots(nextSlots);
    setClassScheduleSlots(nextSlots);
    setForm((current) => ({ ...current, ...formatted }));
  };
  const addClassScheduleSlot = () => {
    const slots = getClassScheduleSlotsFromForm();
    syncClassScheduleSlots([
      ...slots,
      createNextClassScheduleSlot(slots),
    ]);
  };
  const updateClassScheduleSlot = (index: number, patch: Partial<ClassScheduleSlot>) => {
    const slots = getClassScheduleSlotsFromForm();
    syncClassScheduleSlots(slots.map((slot, slotIndex) => slotIndex === index ? { ...slot, ...patch } : slot));
  };
  const removeClassScheduleSlot = (index: number) => {
    const nextSlots = getClassScheduleSlotsFromForm().filter((_, slotIndex) => slotIndex !== index);
    syncClassScheduleSlots(nextSlots.length > 0 ? nextSlots : [createEmptyClassScheduleSlot()]);
  };

  const renderClassScheduleSlotEditor = () => {
    if (kind !== "classes") return null;
    const slots = getClassScheduleSlotsFromForm();

    return (
      <section data-testid="class-schedule-slot-editor" className="space-y-3 rounded-md border bg-background p-3 sm:col-span-2">
        <div
          data-testid="class-schedule-slot-header"
          className={cn("hidden px-2 text-[11px] font-medium text-muted-foreground md:grid", CLASS_SCHEDULE_SLOT_GRID_CLASS_NAME)}
        >
          <div>요일</div>
          <div>시작시각</div>
          <div>종료시각</div>
          <div>선생님</div>
          <div>강의실</div>
          <div className="sr-only">관리</div>
        </div>
        <div className="grid gap-2">
          {slots.map((slot, index) => {
            const teacherOptions = getEditableFieldOptions("teacher", slot.teacher);
            const classroomOptions = getEditableFieldOptions("classroom", slot.classroom);
            const rowId = `class-schedule-slot-${index}`;

            return (
	              <div
	                key={rowId}
	                data-testid="class-schedule-slot-row"
		                className={cn(CLASS_SCHEDULE_SLOT_GRID_CLASS_NAME, "px-2 py-1")}
	              >
		                <div className="grid min-w-0 gap-1">
		                  <Label htmlFor={`${rowId}-day`} className="text-[11px] font-medium text-muted-foreground md:sr-only">요일</Label>
		                  <Select
		                    value={slot.day || "__none__"}
		                    onValueChange={(value) => updateClassScheduleSlot(index, { day: value === "__none__" ? "" : value })}
		                    disabled={!canMutateRows}
	                  >
	                    <SelectTrigger id={`${rowId}-day`} className="w-full min-w-0">
	                      <SelectValue placeholder="요일" />
	                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">선택 안 함</SelectItem>
                      {CLASS_SCHEDULE_DAYS.map((day) => (
                        <SelectItem key={day} value={day}>{day}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
	                </div>
		                <div className="grid min-w-0 gap-1">
		                  <Label className="text-[11px] font-medium text-muted-foreground md:sr-only">시작시각</Label>
		                  <div className="relative">
		                    <TimePickerControl
		                      value={slot.startTime}
	                      onChange={(value) => updateClassScheduleSlot(index, { startTime: value })}
	                      placeholder="시작"
	                      ariaLabel={`수업시간 ${index + 1} 시작시각`}
	                      disabled={!canMutateRows}
	                      className={cn("min-w-0", slot.startTime ? "pr-14" : "")}
	                    />
                    <FieldClearButton
                      aria-label={`수업시간 ${index + 1} 시작시각 초기화`}
                      show={Boolean(slot.startTime)}
                      onClick={() => updateClassScheduleSlot(index, { startTime: "" })}
                      disabled={!canMutateRows}
                    />
                  </div>
	                </div>
		                <div className="grid min-w-0 gap-1">
		                  <Label className="text-[11px] font-medium text-muted-foreground md:sr-only">종료시각</Label>
		                  <div className="relative">
		                    <TimePickerControl
	                      value={slot.endTime}
	                      onChange={(value) => updateClassScheduleSlot(index, { endTime: value })}
	                      placeholder="종료"
	                      ariaLabel={`수업시간 ${index + 1} 종료시각`}
	                      disabled={!canMutateRows}
	                      className={cn("min-w-0", slot.endTime ? "pr-14" : "")}
	                    />
                    <FieldClearButton
                      aria-label={`수업시간 ${index + 1} 종료시각 초기화`}
                      show={Boolean(slot.endTime)}
                      onClick={() => updateClassScheduleSlot(index, { endTime: "" })}
                      disabled={!canMutateRows}
                    />
                  </div>
	                </div>
		                <div className="grid min-w-0 gap-1">
		                  <Label htmlFor={`${rowId}-teacher`} className="text-[11px] font-medium text-muted-foreground md:sr-only">선생님</Label>
		                  <Select
		                    value={slot.teacher || "__none__"}
	                    onValueChange={(value) => updateClassScheduleSlot(index, { teacher: value === "__none__" ? "" : value })}
	                    disabled={!canMutateRows}
	                  >
	                    <SelectTrigger id={`${rowId}-teacher`} className="w-full min-w-0">
	                      <SelectValue placeholder="선생님" />
	                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">선택 안 함</SelectItem>
                      {teacherOptions.map((option) => (
                        <SelectItem key={`${rowId}-teacher-${option}`} value={option}>{option}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
	                </div>
		                <div className="grid min-w-0 gap-1">
		                  <Label htmlFor={`${rowId}-classroom`} className="text-[11px] font-medium text-muted-foreground md:sr-only">강의실</Label>
		                  <Select
		                    value={slot.classroom || "__none__"}
	                    onValueChange={(value) => updateClassScheduleSlot(index, { classroom: value === "__none__" ? "" : value })}
	                    disabled={!canMutateRows}
	                  >
	                    <SelectTrigger id={`${rowId}-classroom`} className="w-full min-w-0">
	                      <SelectValue placeholder="강의실" />
	                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">선택 안 함</SelectItem>
                      {classroomOptions.map((option) => (
                        <SelectItem key={`${rowId}-classroom-${option}`} value={option}>{option}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
	                <div className="flex min-w-0 items-end justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 text-muted-foreground hover:text-destructive"
                    onClick={() => removeClassScheduleSlot(index)}
                    disabled={!canMutateRows || slots.length <= 1}
                    aria-label="시간표 행 삭제"
                    title="시간표 행 삭제"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          onClick={addClassScheduleSlot}
          disabled={!canMutateRows}
        >
          <Plus className="mr-1.5 size-4" aria-hidden="true" />
          시간 추가
        </Button>
      </section>
    );
  };

  const renderEditableFields = (scope: "detail" | "form" | "quick", fieldNames?: string[]) => {
    const selectedClassGroupIds = new Set(parseClassGroupIds(form.classGroupIds));
    const selectedClassGroups = classGroupOptions.filter((group) => selectedClassGroupIds.has(group.id));
    const selectedClassGroupLabel =
      selectedClassGroups.length === 0
        ? "기간 선택"
        : selectedClassGroups.length <= 2
          ? selectedClassGroups.map((group) => group.name).join(", ")
          : `${selectedClassGroups[0]?.name || "기간"} 외 ${selectedClassGroups.length - 1}개`;
    const classGroupField: Field = { name: "classGroupIds", label: "기간", placeholder: "기간 선택" };
    const fieldsToRender = fieldNames
      ? fieldNames.map((fieldName) => fieldName === "classGroupIds" ? classGroupField : FORM_FIELDS[kind].find((field) => field.name === fieldName)).filter((field): field is Field => Boolean(field))
      : kind === "classes" ? [...FORM_FIELDS[kind], classGroupField] : FORM_FIELDS[kind];
    const toggleClassGroup = (groupId: string) => {
      const nextIds = new Set(selectedClassGroupIds);
      if (nextIds.has(groupId)) {
        nextIds.delete(groupId);
      } else {
        nextIds.add(groupId);
      }
      setForm((current) => ({ ...current, classGroupIds: stringifyClassGroupIds([...nextIds]) }));
    };

    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {fieldsToRender.map((field) => {
          const id = `${kind}-${scope}-${field.name}`;
          const value = form[field.name] || "";
          const selectOptions = getEditableFieldOptions(field.name, value);
          const fieldWrapperClassName = cn("space-y-2", field.multiline || (kind === "classes" && scope === "detail" && field.name === "name") ? "sm:col-span-2" : "");
          return (
            <div key={field.name} className={fieldWrapperClassName}>
              <Label htmlFor={id}>{field.label}</Label>
              {kind === "classes" && field.name === "classGroupIds" ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 w-full justify-between px-3 font-normal"
                      disabled={!canMutateRows || classGroupOptions.length === 0}
                    >
                      <span className={cn("truncate", selectedClassGroups.length === 0 && "text-muted-foreground")}>
                        {classGroupOptions.length === 0 ? "기간 없음" : selectedClassGroupLabel}
                      </span>
                      <ChevronDown className="ml-2 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </Button>
	                  </PopoverTrigger>
	                  <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-1">
                    <div className="max-h-72 overflow-y-auto">
                      {classGroupOptions.map((group) => {
                        const checked = selectedClassGroupIds.has(group.id);
                        return (
                          <button
                            key={group.id}
                            type="button"
                            className={cn(
                              "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted",
                              checked && "bg-primary/10 text-primary hover:bg-primary/10",
                            )}
                            onClick={() => toggleClassGroup(group.id)}
                            disabled={!canMutateRows}
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input bg-background",
                                checked && "border-primary bg-primary text-primary-foreground",
                              )}
                            >
                              {checked ? <Check className="size-3" /> : null}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
                            {group.subject ? <Badge variant="secondary" className="shrink-0">{group.subject}</Badge> : null}
                          </button>
                        );
                      })}
	                    </div>
	                  </PopoverContent>
	                </Popover>
	              ) : kind === "classes" && field.name === "fee" ? (
	                <ClassTuitionManwonInput
	                  id={id}
	                  name={field.name}
	                  value={value}
	                  placeholder={field.placeholder}
	                  required={field.required}
	                  disabled={!canMutateRows}
	                  autoFocus={scope === "form" && field.name === FORM_FIELDS[kind][0]?.name}
	                  onChange={(nextValue) => handleEditableFieldChange(field.name, nextValue)}
	                />
	              ) : field.multiline ? (
	                <Textarea
                  id={id}
                  name={field.name}
                  value={value}
                  placeholder={field.placeholder}
                  disabled={!canMutateRows}
                  onChange={(event) => setForm((current) => ({ ...current, [field.name]: event.target.value }))}
                />
              ) : selectOptions.length > 0 ? (
                <Select
                  value={value || "__none__"}
                  onValueChange={(nextValue) => handleEditableFieldChange(field.name, nextValue)}
                  disabled={!canMutateRows}
                >
                  <SelectTrigger id={id} className="w-full">
                    <SelectValue placeholder={field.placeholder || `${field.label} 선택`} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">선택 안 함</SelectItem>
                    {selectOptions.map((option) => (
                      <SelectItem key={`${field.name}-${option}`} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={id}
                  name={field.name}
                  type={field.type || "text"}
                  inputMode={field.inputMode}
                  autoComplete={field.autoComplete || "off"}
                  autoFocus={scope === "form" && field.name === FORM_FIELDS[kind][0]?.name}
                  value={value}
                  placeholder={field.placeholder}
                  required={field.required}
                  disabled={!canMutateRows}
                  onChange={(event) => setForm((current) => ({ ...current, [field.name]: event.target.value }))}
                />
              )}
            </div>
          );
        })}

      </div>
    );
  };

  const openRow = useCallback(async (
    row: ManagementRow,
    options: {
      tab?: ClassDetailTab;
      syncRoute?: boolean;
    } = {},
  ) => {
    const nextTab = kind === "classes" ? normalizeClassDetailTab(options.tab) : "basic";
    const nextForm = initialForm(kind, row);
    setSelectedRow(row);
    setForm(nextForm);
    setClassScheduleSlots(kind === "classes" ? parseClassScheduleSlots(nextForm.schedule, nextForm.teacher, nextForm.classroom) : []);
    setTargetId("");
    setPendingRelationMode(null);
    setPendingClassStudentDetailId("");
    setRelationPickerOpen(false);
    setDetailRowQuery("");
    setRelationQuery("");
    setOperationError(null);
    setSaveNotice("");
    setDialogMode("detail");
    if (kind === "classes" && options.syncRoute !== false) {
      writeClassDetailRoute(row.id, nextTab);
    }
    if (kind === "students" && options.syncRoute !== false) {
      writeStudentDetailRoute(row.id);
    }
    if (kind === "students") setRelatedRows(await service.listClasses());
    if (kind === "classes") setRelatedRows(await service.listStudents());
  }, [kind, writeClassDetailRoute, writeStudentDetailRoute]);

  useEffect(() => {
    if (kind !== "classes" || loading || !requestedClassId) {
      return;
    }

    if (classDetailRouteClearPendingRef.current) {
      return;
    }

    if (selectedRow?.id === requestedClassId && dialogMode === "detail") {
      return;
    }

    const targetRow = rows.find((row) => row.id === requestedClassId);
    if (targetRow) {
      void openRow(targetRow, {
        tab: requestedClassDetailTab,
        syncRoute: false,
      });
    }
  }, [
    dialogMode,
    kind,
    loading,
    openRow,
    requestedClassDetailTab,
    requestedClassId,
    rows,
    selectedRow?.id,
  ]);

  useEffect(() => {
    if (kind !== "students" || loading || !requestedStudentId) {
      return;
    }

    if (studentDetailRouteClearPendingRef.current) {
      return;
    }

    if (selectedRow?.id === requestedStudentId && dialogMode === "detail") {
      return;
    }

    const targetRow = rows.find((row) => row.id === requestedStudentId);
    if (targetRow) {
      void openRow(targetRow, { syncRoute: false });
    }
  }, [
    dialogMode,
    kind,
    loading,
    openRow,
    requestedStudentId,
    rows,
    selectedRow?.id,
  ]);

  useEffect(() => {
    if (
      kind !== "classes" ||
      dialogMode !== "detail" ||
      !requestedClassDetailStudentId
    ) {
      return;
    }

    const scrollFocusedRosterStudent = () => {
      const row = document.getElementById(`class-roster-student-${requestedClassDetailStudentId}`);
      if (row) {
        scrollClassDetailTargetIntoView(row);
      }
    };
    const timer = window.setTimeout(scrollFocusedRosterStudent, 80);
    const retryTimer = window.setTimeout(scrollFocusedRosterStudent, 450);

    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
    };
  }, [dialogMode, kind, relatedRows.length, requestedClassDetailStudentId, selectedRow?.id]);

  const handleBulkUpdateRows = useCallback(async (rows: ManagementRow[], change: { field: string; value: string }) => {
    const value = text(change.value);
    if (rows.length === 0 || !value) {
      return;
    }
    if (!canMutateRows) {
      setOperationError("수정 권한이 없습니다.");
      return;
    }

    setSaving(true);
    setOperationError(null);
    try {
      await Promise.all(rows.map((row) => {
        const payload = compact({ [change.field]: value }, kind, row);
        if (kind === "students") return service.updateStudent(payload);
        if (kind === "classes") return service.updateClass(payload);
        return service.updateTextbook(payload);
      }));
      await refresh();
    } catch (bulkError) {
      setOperationError(getSaveErrorMessage(bulkError));
    } finally {
      setSaving(false);
    }
  }, [canMutateRows, kind, refresh]);

  const deleteRows = useCallback(async (rows: ManagementRow[]) => {
    if (rows.length === 0) {
      return;
    }
    if (kind === "classes") {
      setOperationError("수업 상태를 종강으로 변경해 주세요.");
      return;
    }
    if (!canMutateRows) {
      setOperationError("처리 권한이 없습니다.");
      return;
    }

    setSaving(true);
    setOperationError(null);
    try {
      await Promise.all(rows.map((row) => {
        if (kind === "students") return service.updateStudent({ ...(row.raw || {}), id: row.id, status: WITHDRAWN_STUDENT_STATUS });
        return service.deleteTextbook(row.id);
      }));
      await refresh();
    } catch (bulkError) {
      setOperationError(bulkError instanceof Error ? bulkError.message : "일괄 처리 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }, [canMutateRows, kind, refresh]);

  const handleBulkDeleteRows = useCallback((rows: ManagementRow[]) => {
    if (rows.length === 0) {
      return;
    }

    setDeleteRequest({ rows });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    const rows = deleteRequest?.rows || [];
    setDeleteRequest(null);
    await deleteRows(rows);
  }, [deleteRequest, deleteRows]);

  const actions = useMemo(() => {
    const base = {
      onCreate: canMutateRows ? () => {
        setSelectedRow(null);
        const nextForm = initialForm(kind);
        if (kind === "classes" && defaultClassGroupIdsForCreate) {
          nextForm.classGroupIds = defaultClassGroupIdsForCreate;
        }
        setForm(nextForm);
        setClassScheduleSlots(kind === "classes" ? parseClassScheduleSlots(nextForm.schedule, nextForm.teacher, nextForm.classroom) : []);
        setPendingRelationMode(null);
        setPendingClassStudentDetailId("");
        setRelationPickerOpen(false);
        setDetailRowQuery("");
        setRelationQuery("");
        setOperationError(null);
        setSaveNotice("");
        setDialogMode("create" as const);
      } : undefined,
      onOpenRow: openRow,
      onBulkUpdateRows: canMutateRows ? handleBulkUpdateRows : undefined,
      onBulkDeleteRows: canMutateRows && kind !== "classes" ? handleBulkDeleteRows : undefined,
      onDeleteRow: kind === "classes" ? undefined : canMutateRows ? (row: ManagementRow) => {
        setDeleteRequest({ rows: [row] });
      } : undefined,
    };
    if (kind === "students") return { ...base, onOpenSchoolMaster: () => router.push("/admin/settings/schools") };
    if (kind === "classes") {
      return {
        ...base,
        onOpenTeacherMaster: () => router.push("/admin/settings/teachers"),
        onOpenClassroomMaster: () => router.push("/admin/settings/classrooms"),
        onOpenTermManager: () => router.push("/admin/settings/class-groups"),
      };
    }
    return base;
  }, [canMutateRows, defaultClassGroupIdsForCreate, handleBulkDeleteRows, handleBulkUpdateRows, kind, openRow, router]);

  const deleteActionLabel = kind === "students" ? "퇴원 처리" : "삭제";
  const deleteRequestCount = deleteRequest?.rows.length || 0;
  const deleteTargetLabel =
    deleteRequestCount === 1
      ? deleteRequest?.rows[0]?.title || config.emptyLabel
      : `${deleteRequestCount}개 ${config.emptyLabel}`;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canMutateRows) {
      setOperationError("등록 권한이 없습니다.");
      return;
    }
    setOperationError(null);
    setSaveNotice("");
    setSaving(true);
    try {
      const payload = compact(form, kind, selectedRow);
      if (kind === "students") {
        await service.createStudent(payload);
      } else if (kind === "classes") {
        const created = await service.createClass(payload);
        const classId = getSavedClassId(created, payload.id);
        await service.replaceClassGroupMemberships({
          classId,
          groupIds: parseClassGroupIds(form.classGroupIds),
        });
      } else {
        await service.createTextbook(payload);
      }
      setDialogMode(null);
      setSelectedRow(null);
      await refresh();
    } catch (saveError) {
      setOperationError(getSaveErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const handleDetailSave = async () => {
    if (!selectedRow) return;
    if (!canMutateRows) {
      setOperationError("수정 권한이 없습니다.");
      return;
    }
    setOperationError(null);
    setSaveNotice("");
    setSaving(true);
    try {
      const payload = compact(form, kind, selectedRow);
      if (kind === "students") {
        await service.updateStudent(payload);
      } else if (kind === "classes") {
        const updated = await service.updateClass(payload);
        const classId = getSavedClassId(updated, payload.id || selectedRow.id);
        await service.replaceClassGroupMemberships({
          classId,
          groupIds: parseClassGroupIds(form.classGroupIds),
        });
      } else {
        await service.updateTextbook(payload);
      }

      const nextTitle =
        text(payload.name || payload.class_name || payload.className || payload.title) || selectedRow.title;
      const nextBadge =
        kind === "classes"
          ? text(payload.subject) || selectedRow.badge
          : kind === "students"
            ? text(payload.grade) || selectedRow.badge
            : text(payload.publisher) || selectedRow.badge;
      const nextClassGroupIds = parseClassGroupIds(form.classGroupIds);
      const nextClassGroups = classGroupOptions.filter((group) => nextClassGroupIds.includes(group.id));

      setSelectedRow((current) =>
        current && current.id === selectedRow.id
          ? {
              ...current,
              title: nextTitle,
              badge: nextBadge,
              raw: {
                ...(current.raw || {}),
                ...payload,
                class_group_ids: nextClassGroupIds,
                classGroupIds: nextClassGroupIds,
                class_groups: nextClassGroups,
                classGroups: nextClassGroups,
                class_group_names: nextClassGroups.map((group) => group.name),
                classGroupNames: nextClassGroups.map((group) => group.name),
              },
              metrics: {
                ...current.metrics,
                classGroupIds: nextClassGroupIds,
                classGroupNames: nextClassGroups.map((group) => group.name),
              },
            }
          : current,
      );
      await refresh();
      setSaveNotice("저장 완료");
    } catch (saveError) {
      setOperationError(getSaveErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const handleRelationSave = async (mode: "enrolled" | "waitlist") => {
    if (!selectedRow || !targetId) return;
    if (!canMutateRows) {
      setOperationError("관계 변경 권한이 없습니다.");
      return;
    }
    const relatedId = targetId;
    setPendingRelationMode(null);
    setSaving(true);
    setOperationError(null);
    setSaveNotice("");
    try {
      if (kind === "students") {
        await service.assignStudentToClass({ studentId: selectedRow.id, classId: relatedId, mode });
      } else if (kind === "classes") {
        await service.assignStudentToClass({ studentId: relatedId, classId: selectedRow.id, mode });
      }
      setTargetId("");
      setRelationQuery("");
      setSelectedRow((current) => current && current.id === selectedRow.id ? updateRelationOnRow(current, kind, relatedId, mode) : current);
      await refresh();
      setSaveNotice(mode === "enrolled" ? "등록 학생 추가 완료" : "대기 학생 추가 완료");
    } catch (relationError) {
      setOperationError(relationError instanceof Error ? relationError.message : "수강/대기 등록 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const requestRelationSave = (mode: "enrolled" | "waitlist") => {
    if (!targetId) return;
    setOperationError(null);
    setPendingRelationMode(mode);
  };

  const confirmRelationSave = () => {
    if (!pendingRelationMode) return;
    void handleRelationSave(pendingRelationMode);
  };

  const handleRelationModeChange = async (id: string, mode: "enrolled" | "waitlist") => {
    if (!selectedRow) return;
    if (!canMutateRows) {
      setOperationError("관계 변경 권한이 없습니다.");
      return;
    }
    setSaving(true);
    setOperationError(null);
    setSaveNotice("");
    try {
      if (kind === "students") {
        await service.assignStudentToClass({ studentId: selectedRow.id, classId: id, mode });
      } else if (kind === "classes") {
        await service.assignStudentToClass({ studentId: id, classId: selectedRow.id, mode });
      }
      setSelectedRow((current) => current && current.id === selectedRow.id ? updateRelationOnRow(current, kind, id, mode) : current);
      await refresh();
      setSaveNotice(mode === "enrolled" ? "등록 전환 완료" : "대기 전환 완료");
    } catch (relationError) {
      setOperationError(relationError instanceof Error ? relationError.message : "등록 상태 변경 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleRelationRemove = async (classId: string, studentId: string) => {
    if (!canMutateRows) {
      setOperationError("관계 변경 권한이 없습니다.");
      return;
    }
    const relatedId = kind === "students" ? classId : studentId;
    setSaving(true);
    setOperationError(null);
    setSaveNotice("");
    try {
      await service.removeStudentFromClass({ studentId, classId });
      setSelectedRow((current) => current && selectedRow && current.id === selectedRow.id ? updateRelationOnRow(current, kind, relatedId, "removed") : current);
      await refresh();
      setSaveNotice("연결 해제 완료");
    } catch (relationError) {
      setOperationError(relationError instanceof Error ? relationError.message : "수강 연결 해제 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (open) return;
    setDialogMode(null);
    setPendingClassStudentDetailId("");
    if (kind === "classes") {
      clearClassDetailRoute();
    }
    if (kind === "students") {
      clearStudentDetailRoute();
    }
  };

  const buildClassDetailReturnPath = (
    tab: ClassDetailTab,
    options: { studentId?: string } = {},
  ) => {
    if (!selectedRow) return "/admin/classes";
    const params = new URLSearchParams();
    params.set("classId", selectedRow.id);
    params.set("tab", tab);
    if (options.studentId) {
      params.set("studentId", options.studentId);
    }
    if (requestedClassReturnPath) {
      params.set("returnTo", requestedClassReturnPath);
    }
    return `/admin/classes?${params.toString()}`;
  };

  const renderSaveStatus = () => {
    if (!canMutateRows && (isCreate || isDetail)) {
      return (
        <div data-testid="management-save-status" className="text-xs font-medium text-muted-foreground">
          읽기 전용
        </div>
      );
    }
    if (saving) {
      return (
        <div data-testid="management-save-status" className="text-xs font-medium text-muted-foreground">
          저장 중
        </div>
      );
    }
    if (operationError) {
      const saveErrorStatusLabel = getSaveErrorStatusLabel(operationError);
      return (
        <div data-testid="management-save-status" className="text-xs font-medium text-destructive">
          {saveErrorStatusLabel}
        </div>
      );
    }
    if (saveNotice) {
      return (
        <div data-testid="management-save-status" className="text-xs font-medium text-primary">
          {saveNotice}
        </div>
      );
    }
    return null;
  };

	  const renderClassMobileActionBar = () => {
	    if (kind !== "classes" || !selectedRow) return null;
	    const mobileSaveStatus = renderSaveStatus();

	    return (
	      <div
        data-testid="class-detail-mobile-action-bar"
        className="sticky bottom-0 z-30 -mx-4 grid gap-1 border-t bg-background/95 p-2 shadow-[0_-8px_20px_-18px_rgba(15,23,42,0.65)] backdrop-blur md:hidden sm:-mx-6"
	      >
	        {mobileSaveStatus ? (
	          <div
	            data-testid="class-detail-mobile-save-status"
            className="flex min-h-6 items-center justify-center rounded-sm bg-muted/40 px-2 py-1"
	          >
	            {mobileSaveStatus}
	          </div>
	        ) : null}
	        <Button
	          type="button"
	          size="sm"
	          variant="outline"
	          data-testid="class-detail-mobile-save"
	          className="h-11 min-w-0 rounded-sm px-3 text-sm"
	          aria-label={saving ? "저장 중" : "저장"}
	          title={saving ? "저장 중" : "저장"}
	          onClick={handleDetailSave}
	          disabled={saving || !canMutateRows}
	        >
	          <Save className="size-3.5" aria-hidden="true" />
	          <span className="ml-1.5 max-w-full truncate">{saving ? "저장 중" : "저장"}</span>
	        </Button>
	      </div>
	    );
	  };

  const scrollClassRosterIntoView = () => {
    document.getElementById("class-detail-students-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const renderClassSummaryBar = () => {
    if (kind !== "classes" || !selectedRow) return null;
    const raw = selectedRow.raw || {};
    const registeredCount = getClassEnrolledStudentIds(selectedRow).length;
    const waitlistCount = getClassWaitlistStudentIds(selectedRow).length;
    const capacity = Number(raw.capacity || selectedRow.metrics.capacity || 0);
    const subject = text(form.subject || raw.subject || selectedRow.badge);
    const status = text(form.status || selectedRow.status);
    const grade = text(form.grade || raw.grade);
    const teacher = text(form.teacher || raw.teacher || raw.teacher_name || raw.teacherName) || "담당 미정";
    const classroom = text(form.classroom || raw.classroom || raw.room) || "강의실 미정";
    const periodLabel = getClassPeriodLabel(selectedRow) || "기간 미정";
    const scheduleSummary = formatClassScheduleSlots(getClassScheduleSlotsFromForm()).schedule.replace(/\n/g, ", ") || "시간 미정";
    const summaryMetaItems = [
      { label: "요일/시간", value: scheduleSummary },
      { label: "선생님", value: teacher },
      { label: "강의실", value: classroom },
    ];
    const capacitySummary = capacity > 0
      ? `${registeredCount}명 (${waitlistCount}명) / ${capacity}명`
      : `${registeredCount}명 (${waitlistCount}명)`;

    return (
      <div data-testid="class-official-summary-bar" className="sticky top-0 z-20 -mx-4 border-b bg-background px-4 py-3 before:absolute before:inset-x-0 before:-top-4 before:h-4 before:bg-background sm:-mx-6 sm:px-6 sm:before:-top-6 sm:before:h-6">
        <div className="flex items-start gap-3">
          <div className="grid min-w-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {grade ? <Badge>{grade}</Badge> : null}
                  {subject ? <Badge>{subject}</Badge> : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {requestedClassReturnPath?.startsWith("/admin/students") ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      data-testid="class-detail-return-to-student"
                      className="h-8 shrink-0 rounded-md px-2.5 text-xs"
                      onClick={() => router.push(requestedClassReturnPath)}
                    >
                      학생 상세
                    </Button>
                  ) : requestedClassReturnPath ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      data-testid="class-detail-return-to-work-queue"
                      className="h-8 shrink-0 rounded-md px-2.5 text-xs"
                      onClick={() => router.push(requestedClassReturnPath)}
                    >
                      {getClassReturnPathLabel(requestedClassReturnPath)}
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="mt-1 truncate text-base font-semibold text-foreground">{selectedRow.title}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {summaryMetaItems.map((item) => (
                  <span key={item.label} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-background px-2 py-1 text-xs text-muted-foreground">
                    <span className="shrink-0">{item.label}</span>
                    <span className="truncate font-medium text-foreground">{item.value}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="grid gap-2 lg:justify-self-end lg:min-w-56">
              <div data-testid="class-summary-period-status" className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                <Badge variant="secondary">{periodLabel}</Badge>
                {status ? <Badge variant="secondary">{status}</Badge> : null}
              </div>
              <button
                type="button"
                data-testid="class-summary-roster-jump"
                className="rounded-md border bg-muted/20 px-2.5 py-2 text-left text-sm transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={scrollClassRosterIntoView}
              >
                <div className="text-xs text-muted-foreground">등록 (대기) / 정원</div>
                <div className="mt-1 font-medium">{capacitySummary}</div>
              </button>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-testid="class-detail-sticky-close"
            className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="수업 상세 닫기"
            title="수업 상세 닫기"
            onClick={() => handleDialogOpenChange(false)}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  };

  const renderRelationManagementSection = () => {
    if (!selectedRow || kind === "textbooks") return null;
    const classEnrolledStudentIds = kind === "classes" ? getClassEnrolledStudentIds(selectedRow) : [];
    const classWaitlistStudentIds = kind === "classes" ? getClassWaitlistStudentIds(selectedRow) : [];
    const selectedRelationRecord = targetId ? resolveRelatedRecord(targetId) : undefined;
    const selectedRelationLabel = selectedRelationRecord
      ? [relatedTitle(selectedRelationRecord), relatedMeta(selectedRelationRecord)].filter(Boolean).join(" · ")
      : "";

    return (
      <section data-testid={kind === "classes" ? "class-student-roster-panel" : undefined} className="space-y-3 border-t pt-4">
        {kind !== "classes" ? (
          <div className="text-sm font-semibold">수업 연결</div>
        ) : null}
        <div className="grid gap-3 rounded-md border bg-background p-3 lg:grid-cols-[minmax(16rem,1fr)_auto_auto]">
          <div data-testid={kind === "classes" ? "class-relation-picker" : undefined} className="grid gap-1.5">
            <Label htmlFor={`${kind}-relation-picker-search`}>{relationLabel} 선택</Label>
            <Popover open={relationPickerOpen} onOpenChange={setRelationPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-full justify-between px-3 font-normal"
                  disabled={!canMutateRows}
                >
                  <span className={cn("truncate", !selectedRelationLabel && "text-muted-foreground")}>
                    {selectedRelationLabel || `${relationLabel} 검색 또는 선택`}
                  </span>
                  <ChevronDown className="ml-2 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-2">
                <div className="grid gap-2">
                  <Input
                    id={`${kind}-relation-picker-search`}
                    data-testid={kind === "classes" ? "class-relation-picker-search" : undefined}
                    value={relationQuery}
                    placeholder={`${relationLabel} 이름 검색`}
                    disabled={!canMutateRows}
                    onChange={(event) => setRelationQuery(event.target.value)}
                  />
                  <div className="max-h-72 overflow-y-auto">
                    {filteredAvailableRelatedRows.length === 0 ? (
                      <div className="px-2 py-3 text-sm text-muted-foreground">추가 가능한 {relationLabel} 없음</div>
                    ) : filteredAvailableRelatedRows.map((record) => {
                      const id = text(record.id);

                      return (
                        <button
                          key={id}
                          type="button"
                          className={cn(
                            "grid w-full gap-0.5 rounded-md px-2 py-2 text-left text-sm hover:bg-muted",
                            targetId === id && "bg-primary/10 text-primary hover:bg-primary/10",
                          )}
                          onClick={() => {
                            setTargetId(id);
                            setRelationQuery("");
                            setRelationPickerOpen(false);
                          }}
                          disabled={!canMutateRows}
                        >
                          <span className="truncate font-medium">{relatedTitle(record)}</span>
                          {relatedMeta(record) ? <span className="truncate text-xs text-muted-foreground">{relatedMeta(record)}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="grid content-end">
            <Button type="button" className="h-10 px-5" onClick={() => requestRelationSave("enrolled")} disabled={!canMutateRows || !targetId || saving}>등록 추가</Button>
          </div>
          <div className="grid content-end">
            <Button type="button" variant="outline" className="h-10 px-5" onClick={() => requestRelationSave("waitlist")} disabled={!canMutateRows || !targetId || saving}>대기 추가</Button>
          </div>
        </div>
        <div className={cn("grid gap-3 text-sm", kind === "students" && "sm:grid-cols-2")}>
          {kind === "students" ? (
            <>
              {renderRelationList("등록 수업", getStudentEnrolledClassIds(selectedRow), "수강")}
              {renderRelationList("대기 수업", getStudentWaitlistClassIds(selectedRow), "대기")}
            </>
          ) : (
            <>
              {renderRelationList("등록 학생", classEnrolledStudentIds, "수강")}
              {renderRelationList("대기 학생", classWaitlistStudentIds, "대기")}
            </>
          )}
        </div>
      </section>
    );
  };

  const relationConfirmRecord = targetId ? resolveRelatedRecord(targetId) : undefined;
  const relationConfirmTargetLabel = relationConfirmRecord ? relatedTitle(relationConfirmRecord, relationLabel) : relationLabel;
  const relationConfirmActionLabel = pendingRelationMode === "enrolled" ? "등록 추가" : "대기 추가";
  const pendingClassStudentDetailRecord = pendingClassStudentDetailId ? resolveRelatedRecord(pendingClassStudentDetailId) : undefined;
  const pendingClassStudentDetailName = pendingClassStudentDetailId
    ? pendingClassStudentDetailRecord
      ? relatedTitle(pendingClassStudentDetailRecord, "학생")
      : resolveRelatedTitle(pendingClassStudentDetailId)
    : "학생";

  return (
    <div className="flex flex-col gap-6">
      {error && !loading ? (
        <div className="px-4 lg:px-6">
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div className="@container/main mt-2 px-4 lg:px-6 lg:mt-4">
        <ManagementDataTable
          kind={kind}
          rows={rows}
          stats={stats}
          loading={loading}
          onRefresh={refresh}
          badgeLabel={config.badgeLabel}
          statusLabel={config.statusLabel}
          emptyLabel={config.emptyLabel}
          actions={actions}
        />
      </div>

      <Dialog open={dialogMode !== null} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          className="z-[80] max-h-[92vh] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] overflow-x-hidden overflow-y-auto p-4 sm:w-full sm:max-w-5xl sm:p-6"
          showCloseButton={kind !== "classes" || !isDetail}
        >
          <DialogHeader className={isDetail && kind === "classes" ? "sr-only" : "pr-10"}>
            <DialogTitle className={isDetail && kind === "classes" ? undefined : "break-keep pr-2 leading-6"}>{dialogTitle}</DialogTitle>
            <DialogDescription className="sr-only">
              선택한 데이터를 확인하고 필요한 항목을 입력하거나 수정합니다.
            </DialogDescription>
          </DialogHeader>

          {operationError && !(isDetail && selectedRow && kind === "classes") ? (
            <Alert variant="destructive">
              <AlertDescription>{operationError}</AlertDescription>
            </Alert>
          ) : null}

          {isDetail && selectedRow && kind === "classes" ? (
            <div data-testid="class-official-detail" className="space-y-4 pb-28 md:pb-0">
              {renderClassSummaryBar()}
              {operationError ? (
                <Alert variant="destructive">
                  <AlertDescription>{operationError}</AlertDescription>
                </Alert>
              ) : null}

              <section data-testid="class-detail-basic-section" className="space-y-3">
                {renderEditableFields("detail", [
                  "grade",
                  "subject",
                  "name",
                  "capacity",
                  "fee",
                  "classGroupIds",
                  "status",
                ])}
                {renderClassScheduleSlotEditor()}
              </section>
              <div id="class-detail-students-section" data-testid="class-detail-students-section" className="space-y-4">
                {renderRelationManagementSection()}
              </div>
              {renderClassMobileActionBar()}

              <DialogFooter className="items-center gap-3">
                {renderSaveStatus()}
                <Button type="button" onClick={handleDetailSave} disabled={saving || !canMutateRows}>{saving ? "저장 중" : "저장"}</Button>
              </DialogFooter>
            </div>
          ) : isDetail && selectedRow ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{selectedRow.badge}</Badge>
                  <Badge variant="secondary">{selectedRow.status}</Badge>
                </div>
                {kind === "students" && requestedStudentReturnPath ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid="student-detail-return-to-class"
                    className="h-8 rounded-md px-2.5 text-xs"
                    onClick={() => router.push(requestedStudentReturnPath)}
                  >
                    수업 상세
                  </Button>
                ) : null}
              </div>

              <section className="space-y-2">
                <Label htmlFor={`${kind}-detail-row-search`}>{detailSearchLabel}</Label>
                <Input
                  id={`${kind}-detail-row-search`}
                  value={detailRowQuery}
                  placeholder={detailSearchLabel}
                  onChange={(event) => setDetailRowQuery(event.target.value)}
                />
                {detailSearchMatches.length > 0 ? (
                  <div className="overflow-hidden rounded-lg border bg-background">
                    {detailSearchMatches.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        className="grid w-full gap-0.5 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/60"
                        onClick={() => void openRow(row)}
                      >
                        <span className="truncate text-sm font-medium">{row.title}</span>
                        <span className="truncate text-xs text-muted-foreground">{row.subtitle || row.metaSummary || "-"}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="border-y py-3">
                <div className="grid gap-2 sm:grid-cols-4">
                  {getDetailMetrics(kind, selectedRow).map((metric) => (
                    <div key={metric.label} className="px-1 py-1.5">
                      <div className="text-xs text-muted-foreground">{metric.label}</div>
                      <div className="mt-1 text-sm font-semibold">{metric.value}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <div className="text-sm font-semibold">{kind === "classes" ? "수업 정보" : kind === "students" ? "학생 정보" : "교재 정보"}</div>
                {renderEditableFields("detail")}
              </section>

              {renderRelationManagementSection()}

              {kind === "students" ? renderStudentHistoryPanel(selectedRow) : null}

              <DialogFooter className="items-center gap-3">
                {renderSaveStatus()}
                <Button type="button" onClick={handleDetailSave} disabled={saving || !canMutateRows}>{saving ? "저장 중" : "저장"}</Button>
                <Button type="button" variant="destructive" onClick={() => actions.onDeleteRow?.(selectedRow)} disabled={saving || !canMutateRows}>
                  {deleteActionLabel}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              {renderEditableFields("form")}
              <DialogFooter className="items-center gap-3">
                {renderSaveStatus()}
                <Button type="button" variant="outline" onClick={() => handleDialogOpenChange(false)} disabled={saving}>취소</Button>
                <Button type="submit" disabled={saving || !canMutateRows}>{saving ? "저장 중" : "등록 저장"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

	      <Dialog open={Boolean(pendingClassStudentDetailId)} onOpenChange={(open) => !open && setPendingClassStudentDetailId("")}>
	        <DialogContent data-testid="class-student-detail-confirm-dialog" className="z-[90] sm:max-w-md">
	          <DialogHeader>
	            <DialogTitle>학생 상세로 이동</DialogTitle>
	            <DialogDescription>
	              {pendingClassStudentDetailName} 학생 상세로 이동할까요?
	            </DialogDescription>
	          </DialogHeader>
	          <DialogFooter>
	            <Button type="button" variant="outline" onClick={() => setPendingClassStudentDetailId("")}>
	              취소
	            </Button>
	            <Button type="button" onClick={confirmClassStudentDetailOpen}>
	              학생 상세 열기
	            </Button>
	          </DialogFooter>
	        </DialogContent>
	      </Dialog>

	      <Dialog open={Boolean(pendingRelationMode)} onOpenChange={(open) => !open && setPendingRelationMode(null)}>
        <DialogContent data-testid="class-relation-confirm-dialog" className="z-[90] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{relationConfirmActionLabel}</DialogTitle>
            <DialogDescription>
              {selectedRow?.title || "선택한 항목"}에 {relationConfirmTargetLabel}을(를) {pendingRelationMode === "enrolled" ? "등록" : "대기"}으로 추가할까요?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingRelationMode(null)} disabled={saving}>
              취소
            </Button>
            <Button type="button" onClick={confirmRelationSave} disabled={saving || !pendingRelationMode || !targetId}>
              {saving ? "처리 중" : relationConfirmActionLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteRequest)} onOpenChange={(open) => !open && setDeleteRequest(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{deleteActionLabel}</DialogTitle>
            <DialogDescription>
              {deleteTargetLabel} {deleteActionLabel}할까요?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteRequest(null)} disabled={saving}>
              취소
            </Button>
            <Button type="button" variant="destructive" onClick={handleConfirmDelete} disabled={saving}>
              {saving ? "처리 중" : deleteActionLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
