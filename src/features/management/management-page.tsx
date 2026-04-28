"use client";

import { FormEvent, useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";

import type { ManagementKind, ManagementRow } from "@/features/management/use-management-records";
import { useManagementRecords } from "@/features/management/use-management-records";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { cn } from "@/lib/utils";

import { ManagementDataTable } from "./management-data-table";
import { managementService } from "./management-service.js";

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
  students: { badgeLabel: "학년", statusLabel: "배정 상태", emptyLabel: "학생" },
  classes: { badgeLabel: "과목", statusLabel: "수업 상태", emptyLabel: "수업" },
  textbooks: { badgeLabel: "출판사", statusLabel: "구성 상태", emptyLabel: "교재" },
} satisfies Record<ManagementKind, { badgeLabel: string; statusLabel: string; emptyLabel: string }>;

type FormState = Record<string, string>;
type RelatedRecord = Record<string, unknown>;
type Field = { name: string; label: string; placeholder?: string; type?: string; required?: boolean; multiline?: boolean };
type DetailInfoItem = { label: string; value: string | number };
type ClassGroupOption = { id: string; name: string; subject?: string };

const CLASS_STATUS_OPTIONS = ["수강", "개강 준비", "종강"] as const;
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
const STUDENT_SELECT_FIELD_NAMES = new Set(["school_category", "school", "grade"]);

const FORM_FIELDS: Record<ManagementKind, Field[]> = {
  students: [
    { name: "name", label: "학생명", placeholder: "김학생", required: true },
    { name: "uid", label: "학생 UID", placeholder: "S-001" },
    { name: "school_category", label: "학교 구분", placeholder: "학교 구분" },
    { name: "school", label: "학교", placeholder: "학교" },
    { name: "grade", label: "학년", placeholder: "학년" },
    { name: "contact", label: "연락처", placeholder: "010-0000-0000" },
    { name: "parentContact", label: "학부모 연락처", placeholder: "010-0000-0000" },
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

const DETAIL_FIELD_LABELS: Record<string, string> = {
  id: "ID",
  uid: "학생 UID",
  name: "이름",
  class_name: "수업명",
  className: "수업명",
  class_groups: "기간",
  classGroups: "기간",
  class_group_names: "기간",
  classGroupNames: "기간",
  title: "교재명",
  subject: "과목",
  school_category: "학교 구분",
  schoolCategory: "학교 구분",
  school_level: "학교 구분",
  schoolLevel: "학교 구분",
  school: "학교",
  grade: "학년",
  contact: "연락처",
  parent_contact: "학부모 연락처",
  parentContact: "학부모 연락처",
  enroll_date: "등록일",
  enrollDate: "등록일",
  teacher: "선생님",
  teacher_name: "선생님",
  teacherName: "선생님",
  schedule: "요일/시간",
  classroom: "강의실",
  room: "강의실",
  capacity: "정원",
  fee: "수업료",
  tuition: "수업료",
  status: "상태",
  publisher: "출판사",
  price: "가격",
  updated_at: "수정일",
  updatedAt: "수정일",
};

const DETAIL_FIELD_ORDER: Record<ManagementKind, string[]> = {
  students: ["name", "uid", "school_category", "schoolCategory", "school_level", "schoolLevel", "school", "grade", "contact", "parent_contact", "parentContact", "enroll_date", "enrollDate", "status"],
  classes: ["class_name", "className", "name", "class_group_names", "classGroupNames", "status", "subject", "grade", "teacher", "teacher_name", "teacherName", "schedule", "classroom", "room", "capacity", "fee", "tuition"],
  textbooks: ["title", "name", "subject", "publisher", "price", "tags", "lessons", "updated_at", "updatedAt"],
};

const DETAIL_FIELD_VISIBLE_KEYS: Record<ManagementKind, string[]> = {
  students: ["name", "uid", "school_category", "schoolCategory", "school_level", "schoolLevel", "school", "grade", "contact", "parent_contact", "parentContact", "enroll_date", "enrollDate", "status"],
  classes: ["class_name", "className", "name", "class_group_names", "classGroupNames", "status", "subject", "grade", "teacher", "teacher_name", "teacherName", "schedule", "classroom", "room", "capacity", "fee", "tuition"],
  textbooks: ["title", "name", "subject", "publisher", "price", "tags", "lessons", "updated_at", "updatedAt"],
};

function text(value: unknown) {
  return String(value || "").trim();
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
    .map((item) => {
      if (item && typeof item === "object") {
        const group = item as Record<string, unknown>;
        const id = text(group.id);
        const name = text(group.name) || id;
        return id || name ? { id: id || name, name, subject: text(group.subject) } : null;
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

function getLabel(kind: ManagementKind) {
  if (kind === "students") return "학생 등록";
  if (kind === "classes") return "수업 등록";
  return "교재 등록";
}

function getEditLabel(kind: ManagementKind) {
  if (kind === "students") return "학생 정보 수정";
  if (kind === "classes") return "수업 정보 수정";
  return "교재 정보 수정";
}

function initialForm(kind: ManagementKind, row?: ManagementRow | null): FormState {
  const raw = (row?.raw || {}) as Record<string, unknown>;
  const valueFor = (name: string) => {
    if (name === "parentContact") return text(raw.parent_contact || raw.parentContact);
    if (name === "enrollDate") return text(raw.enroll_date || raw.enrollDate).slice(0, 10);
    if (name === "name") return text(raw.name || raw.class_name || raw.className || row?.title);
    if (name === "school_category") return getStudentSchoolCategoryFromRaw(raw);
    if (name === "status") return normalizeClassStatusForForm(raw.status || row?.status || row?.statusValue);
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

function relatedTitle(record: RelatedRecord) {
  return text(record.name || record.class_name || record.className || record.title || record.id);
}

function normalizeRelatedRecordList(value: unknown): RelatedRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (item && typeof item === "object") return item as RelatedRecord;
      const id = text(item);
      return id ? { id, name: id } : null;
    })
    .filter((item): item is RelatedRecord => Boolean(item && text(item.id)));
}

function getEmbeddedRelatedRecords(kind: ManagementKind, row?: ManagementRow | null) {
  if (!row || kind !== "classes") return [];
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

function formatMoney(value: unknown) {
  const amount = Number(text(value).replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return `${new Intl.NumberFormat("ko-KR").format(amount)}원`;
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

function formatFieldLabel(key: string) {
  return DETAIL_FIELD_LABELS[key] || key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
}

function renderFieldValue(value: unknown) {
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "-";
  return text(value) || "-";
}

function getVisibleDetailKeys(kind: ManagementKind) {
  return new Set(DETAIL_FIELD_VISIBLE_KEYS[kind]);
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

function renderFieldGrid(kind: ManagementKind, row: ManagementRow) {
  const raw = (row.raw || {}) as Record<string, unknown>;
  const visibleKeys = getVisibleDetailKeys(kind);
  const orderedKeys = DETAIL_FIELD_ORDER[kind].filter((key) => visibleKeys.has(key) && Object.prototype.hasOwnProperty.call(raw, key));

  return orderedKeys.map((key) => {
    const value = raw[key];
    return (
      <div key={key} className="border-b py-2 text-sm">
        <div className="text-xs text-muted-foreground">{formatFieldLabel(key)}</div>
        <div className="break-all">{renderFieldValue(value)}</div>
      </div>
    );
  });
}

function getClassDetailItems(row: ManagementRow): DetailInfoItem[] {
  const raw = (row.raw || {}) as Record<string, unknown>;
  const scheduleLines = Array.isArray(raw.scheduleLines)
    ? raw.scheduleLines.map((line) => text(line)).filter(Boolean)
    : Array.isArray(raw.schedule_lines)
      ? raw.schedule_lines.map((line) => text(line)).filter(Boolean)
      : [];
  const schedule = scheduleLines.length > 0 ? scheduleLines.join(" / ") : text(raw.schedule);
  const tuition = text(raw.tuition_label || raw.tuitionLabel) || formatMoney(raw.fee || raw.tuition);

  return [
    { label: "선생님", value: text(raw.teacher || raw.teacher_name || raw.teacherName) || "-" },
    { label: "강의실", value: text(raw.classroom || raw.room) || "-" },
    { label: "요일/시간", value: schedule || "-" },
    { label: "수업료", value: tuition || "-" },
  ];
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
    const textbookCount = idList(raw.textbook_ids || raw.textbookIds).length;
    return [
      detailMetric("수강생", enrolledCount),
      detailMetric("대기자", waitlistCount),
      detailMetric("정원", capacity > 0 ? `${enrolledCount}/${capacity}` : "-"),
      detailMetric("교재 연결", `${textbookCount}권`),
    ];
  }

  if (kind === "students") {
    return [
      detailMetric("수강 수업", getStudentEnrolledClassIds(row).length),
      detailMetric("대기 수업", getStudentWaitlistClassIds(row).length),
      detailMetric("학교", text(raw.school) || "-"),
      detailMetric("학년", text(raw.grade) || "-"),
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

export function ManagementPage({ kind }: { kind: ManagementKind }) {
  const router = useRouter();
  const config = PAGE_CONFIG[kind];
  const { rows, stats, loading, error, refresh } = useManagementRecords(kind);
  const [dialogMode, setDialogMode] = useState<"create" | "detail" | null>(null);
  const [selectedRow, setSelectedRow] = useState<ManagementRow | null>(null);
  const [form, setForm] = useState<FormState>(() => initialForm(kind));
  const [operationError, setOperationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [relatedRows, setRelatedRows] = useState<RelatedRecord[]>([]);
  const [targetId, setTargetId] = useState("");
  const [relationMode, setRelationMode] = useState<"enrolled" | "waitlist">("enrolled");
  const [detailRowQuery, setDetailRowQuery] = useState("");
  const [relationQuery, setRelationQuery] = useState("");

  const createLabel = getLabel(kind);
  const isCreate = dialogMode === "create";
  const isDetail = dialogMode === "detail";
  const dialogTitle = isCreate ? createLabel : `${selectedRow?.title || ""} 상세 정보`;
  const relatedRecordsById = useMemo(
    () => {
      const records = new Map<string, RelatedRecord>();
      for (const record of relatedRows) {
        const id = text(record.id);
        if (id) records.set(id, record);
      }
      for (const record of getEmbeddedRelatedRecords(kind, selectedRow)) {
        const id = text(record.id);
        if (id) records.set(id, record);
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
  const classSelectOptions = useMemo(() => {
    if (kind !== "classes") {
      return {} as Record<string, string[]>;
    }

    const rawRows = rows.map((row) => row.raw || {});

    return {
      status: [...CLASS_STATUS_OPTIONS],
      subject: uniqueSortedOptions(rawRows.map((raw) => text(raw.subject)), ["영어", "수학"]),
      grade: uniqueSortedOptions(rawRows.map((raw) => text(raw.grade))),
      teacher: uniqueSortedOptions(
        rawRows.flatMap((raw) => splitOptionValues(raw.teacher || raw.teacher_name || raw.teacherName)),
      ),
      classroom: uniqueSortedOptions(
        rawRows.flatMap((raw) => splitOptionValues(raw.classroom || raw.room)),
      ),
    } satisfies Record<string, string[]>;
  }, [kind, rows]);
  const studentSelectOptions = useMemo(() => {
    if (kind !== "students") {
      return {} as Record<string, string[]>;
    }

    const rawRows = rows.map((row) => (row.raw || {}) as Record<string, unknown>);
    const category = getStudentSchoolCategoryFromForm(form);

    return {
      school_category: [...STUDENT_SCHOOL_CATEGORY_OPTIONS],
      school: getStudentSchoolOptions(rawRows, category),
      grade: getStudentGradeOptions(rawRows, category),
    } satisfies Record<string, string[]>;
  }, [form.grade, form.school_category, form.schoolCategory, kind, rows]);
  const classGroupOptions = useMemo(
    () => (kind === "classes" ? getClassGroupOptionsFromRows(rows) : []),
    [kind, rows],
  );
  const resolveRelatedRecord = (id: string) => relatedRecordsById.get(id);
  const resolveRelatedTitle = (id: string) => {
    const record = resolveRelatedRecord(id);
    return record ? relatedTitle(record) : id;
  };
  const renderRelationList = (label: string, ids: string[], modeLabel: "수강" | "대기") => (
    <section className="overflow-hidden rounded-md border bg-background">
      <div className="flex h-10 items-center justify-between border-b px-3">
        <div className="text-sm font-semibold">{label}</div>
        <Badge variant="secondary" className="h-6 rounded-full px-2">
          {ids.length}{kind === "students" ? "개" : "명"}
        </Badge>
      </div>
      {ids.length > 0 ? (
        <div className="divide-y">
          {ids.map((id) => (
            <div key={`${modeLabel}-${id}`} className="flex items-center justify-between gap-3 px-3 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{resolveRelatedTitle(id)}</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">{relatedMeta(resolveRelatedRecord(id)) || modeLabel}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => handleRelationModeChange(id, modeLabel === "수강" ? "waitlist" : "enrolled")}
                  disabled={saving}
                >
                  {modeLabel === "수강" ? "대기로" : "등록"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-destructive hover:text-destructive"
                  onClick={() => kind === "students" ? handleRelationRemove(id, selectedRow?.id || "") : handleRelationRemove(selectedRow?.id || "", id)}
                  disabled={saving}
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
  const renderDetailInfo = (items: DetailInfoItem[]) => (
    <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="border-b py-2 text-sm">
          <div className="text-xs text-muted-foreground">{item.label}</div>
          <div className="break-words font-medium">{item.value}</div>
        </div>
      ))}
    </div>
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

  const renderEditableFields = (scope: "detail" | "form") => {
    const selectedClassGroupIds = new Set(parseClassGroupIds(form.classGroupIds));
    const selectedClassGroups = classGroupOptions.filter((group) => selectedClassGroupIds.has(group.id));
    const selectedClassGroupLabel =
      selectedClassGroups.length === 0
        ? "기간 선택"
        : selectedClassGroups.length <= 2
          ? selectedClassGroups.map((group) => group.name).join(", ")
          : `${selectedClassGroups[0]?.name || "기간"} 외 ${selectedClassGroups.length - 1}개`;
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
        {FORM_FIELDS[kind].map((field) => {
          const id = `${kind}-${scope}-${field.name}`;
          const value = form[field.name] || "";
          const selectOptions = getEditableFieldOptions(field.name, value);
          return (
            <div key={field.name} className={field.multiline ? "space-y-2 sm:col-span-2" : "space-y-2"}>
              <Label htmlFor={id}>{field.label}</Label>
              {field.multiline ? (
                <Textarea
                  id={id}
                  value={value}
                  placeholder={field.placeholder}
                  onChange={(event) => setForm((current) => ({ ...current, [field.name]: event.target.value }))}
                />
              ) : selectOptions.length > 0 ? (
                <Select
                  value={value || "__none__"}
                  onValueChange={(nextValue) => handleEditableFieldChange(field.name, nextValue)}
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
                  type={field.type || "text"}
                  value={value}
                  placeholder={field.placeholder}
                  required={field.required}
                  onChange={(event) => setForm((current) => ({ ...current, [field.name]: event.target.value }))}
                />
              )}
            </div>
          );
        })}

        {kind === "classes" ? (
          <div className="space-y-2 sm:col-span-2">
            <Label>기간</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-full justify-between px-3 font-normal"
                  disabled={classGroupOptions.length === 0}
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
          </div>
        ) : null}
      </div>
    );
  };

  async function openRow(row: ManagementRow) {
    setSelectedRow(row);
    setForm(initialForm(kind, row));
    setTargetId("");
    setRelationMode("enrolled");
    setDetailRowQuery("");
    setRelationQuery("");
    setOperationError(null);
    setDialogMode("detail");
    if (kind === "students") setRelatedRows(await service.listClasses());
    if (kind === "classes") setRelatedRows(await service.listStudents());
  }

  const actions = useMemo(() => {
    const base = {
      onCreate: () => {
        setSelectedRow(null);
        setForm(initialForm(kind));
        setDetailRowQuery("");
        setRelationQuery("");
        setOperationError(null);
        setDialogMode("create" as const);
      },
      onOpenRow: openRow,
      onDeleteRow: async (row: ManagementRow) => {
        if (!window.confirm(`${row.title} 항목을 삭제할까요?`)) return;
        setSaving(true);
        try {
          if (kind === "students") await service.deleteStudent(row.id);
          else if (kind === "classes") await service.deleteClass(row.id);
          else await service.deleteTextbook(row.id);
          await refresh();
        } catch (deleteError) {
          setOperationError(deleteError instanceof Error ? deleteError.message : "삭제 중 오류가 발생했습니다.");
        } finally {
          setSaving(false);
        }
      },
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
  }, [kind, router, refresh]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOperationError(null);
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
    setOperationError(null);
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
    } catch (saveError) {
      setOperationError(getSaveErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const handleRelationSave = async () => {
    if (!selectedRow || !targetId) return;
    const relatedId = targetId;
    setSaving(true);
    setOperationError(null);
    try {
      if (kind === "students") {
        await service.assignStudentToClass({ studentId: selectedRow.id, classId: relatedId, mode: relationMode });
      } else if (kind === "classes") {
        await service.assignStudentToClass({ studentId: relatedId, classId: selectedRow.id, mode: relationMode });
      }
      setTargetId("");
      setRelationQuery("");
      setSelectedRow((current) => current && current.id === selectedRow.id ? updateRelationOnRow(current, kind, relatedId, relationMode) : current);
      await refresh();
    } catch (relationError) {
      setOperationError(relationError instanceof Error ? relationError.message : "수강/대기 등록 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleRelationModeChange = async (id: string, mode: "enrolled" | "waitlist") => {
    if (!selectedRow) return;
    setSaving(true);
    setOperationError(null);
    try {
      if (kind === "students") {
        await service.assignStudentToClass({ studentId: selectedRow.id, classId: id, mode });
      } else if (kind === "classes") {
        await service.assignStudentToClass({ studentId: id, classId: selectedRow.id, mode });
      }
      setSelectedRow((current) => current && current.id === selectedRow.id ? updateRelationOnRow(current, kind, id, mode) : current);
      await refresh();
    } catch (relationError) {
      setOperationError(relationError instanceof Error ? relationError.message : "등록 상태 변경 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleRelationRemove = async (classId: string, studentId: string) => {
    const relatedId = kind === "students" ? classId : studentId;
    setSaving(true);
    setOperationError(null);
    try {
      await service.removeStudentFromClass({ studentId, classId });
      setSelectedRow((current) => current && selectedRow && current.id === selectedRow.id ? updateRelationOnRow(current, kind, relatedId, "removed") : current);
      await refresh();
    } catch (relationError) {
      setOperationError(relationError instanceof Error ? relationError.message : "수강 연결 해제 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

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

      <Dialog open={dialogMode !== null} onOpenChange={(open) => !open && setDialogMode(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>

          {operationError ? (
            <Alert variant="destructive">
              <AlertDescription>{operationError}</AlertDescription>
            </Alert>
          ) : null}

          {isDetail && selectedRow ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{selectedRow.badge}</Badge>
                  <Badge variant="secondary">{selectedRow.status}</Badge>
                </div>
                {kind === "classes" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => router.push(`/admin/curriculum/lesson-design?classId=${encodeURIComponent(selectedRow.id)}`)}
                    aria-label="수업 상세에서 수업설계로 이동"
                  >
                    수업 설계 열기
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

              {kind !== "textbooks" ? (
                <section className="space-y-3 border-t pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">{relationLabel} 관리</div>
                  </div>
                  <div className="grid gap-3 rounded-md border bg-background p-3 lg:grid-cols-[minmax(14rem,1fr)_minmax(14rem,1fr)_auto_auto]">
                    <div className="grid gap-1.5">
                      <Label>{relationLabel} 검색</Label>
                      <Input
                        value={relationQuery}
                        placeholder={`${relationLabel} 이름 검색`}
                        onChange={(event) => setRelationQuery(event.target.value)}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label>{relationLabel} 선택</Label>
                      <Select value={targetId || "none"} onValueChange={(value) => setTargetId(value === "none" ? "" : value)}>
                        <SelectTrigger className="w-full"><SelectValue placeholder={`${relationLabel} 선택`} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">선택 없음</SelectItem>
                          {filteredAvailableRelatedRows.length === 0 ? (
                            <SelectItem value="empty" disabled>추가 가능한 {relationLabel} 없음</SelectItem>
                          ) : null}
                          {filteredAvailableRelatedRows.map((record) => (
                            <SelectItem key={text(record.id)} value={text(record.id)}>
                              {[relatedTitle(record), relatedMeta(record)].filter(Boolean).join(" · ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label>상태</Label>
                      <div className="grid grid-cols-2 rounded-md border bg-background p-1">
                        <Button
                          type="button"
                          variant={relationMode === "enrolled" ? "default" : "ghost"}
                          size="sm"
                          className="h-8"
                          onClick={() => setRelationMode("enrolled")}
                          aria-pressed={relationMode === "enrolled"}
                        >
                          등록
                        </Button>
                        <Button
                          type="button"
                          variant={relationMode === "waitlist" ? "default" : "ghost"}
                          size="sm"
                          className="h-8"
                          onClick={() => setRelationMode("waitlist")}
                          aria-pressed={relationMode === "waitlist"}
                        >
                          대기
                        </Button>
                      </div>
                    </div>
                    <div className="grid content-end">
                      <Button type="button" className="h-10 px-5" onClick={handleRelationSave} disabled={!targetId || saving}>
                        {relationMode === "enrolled" ? "등록 추가" : "대기 추가"}
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    {kind === "students" ? (
                      <>
                        {renderRelationList("등록 수업", getStudentEnrolledClassIds(selectedRow), "수강")}
                        {renderRelationList("대기 수업", getStudentWaitlistClassIds(selectedRow), "대기")}
                      </>
                    ) : (
                      <>
                        {renderRelationList("등록 학생", getClassEnrolledStudentIds(selectedRow), "수강")}
                        {renderRelationList("대기 학생", getClassWaitlistStudentIds(selectedRow), "대기")}
                      </>
                    )}
                  </div>
                </section>
              ) : null}

              <DialogFooter>
                <Button type="button" onClick={handleDetailSave} disabled={saving}>{saving ? "저장 중" : "저장"}</Button>
                <Button type="button" variant="destructive" onClick={() => actions.onDeleteRow?.(selectedRow)} disabled={saving}>삭제</Button>
              </DialogFooter>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              {renderEditableFields("form")}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogMode(null)} disabled={saving}>취소</Button>
                <Button type="submit" disabled={saving}>{saving ? "저장 중" : "등록 저장"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
