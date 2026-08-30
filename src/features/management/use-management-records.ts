"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";
import {
  buildClassManagementStats,
  buildStudentManagementStats,
  buildTextbookManagementStats,
  normalizeClassManagementRecord,
  normalizeStudentManagementRecord,
  normalizeTextbookManagementRecord,
} from "./records.js";
import { buildCurriculumWorkspaceModel } from "../academic/records.js";
import { createManagementReadService, getAssignedClassTextbookIds } from "./management-service.js";
import type { ManagementListPageSize } from "./management-page-size";
import {
  createManagementRequestGate,
  type ManagementRequestTicket,
} from "./management-request-gate";

export type ManagementKind = "students" | "classes" | "textbooks";

export type ManagementStat = {
  label: string;
  value: string;
  hint: string;
};

export type ManagementRow = {
  kind: ManagementKind;
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  badgeValue: string;
  status: string;
  statusValue: string;
  metaSummary: string;
  searchText: string;
  raw: Record<string, unknown>;
  metrics: Record<string, unknown>;
};

export type ClassFormReferences = {
  teacherCatalogs: Record<string, unknown>[];
  classroomCatalogs: Record<string, unknown>[];
  scienceSubjectAreas: Record<string, unknown>[];
};

const EMPTY_CLASS_FORM_REFERENCES: ClassFormReferences = {
  teacherCatalogs: [],
  classroomCatalogs: [],
  scienceSubjectAreas: [],
};

const CONFIG = {
  students: {
    table: "students",
    normalize: (row: Record<string, unknown>) =>
      normalizeStudentManagementRecord(row) as ManagementRow,
    buildStats: (rows: ManagementRow[]) =>
      buildStudentManagementStats(rows) as ManagementStat[],
  },
  classes: {
    table: "classes",
    normalize: (row: Record<string, unknown>) =>
      normalizeClassManagementRecord(row) as ManagementRow,
    buildStats: (rows: ManagementRow[]) =>
      buildClassManagementStats(rows) as ManagementStat[],
  },
  textbooks: {
    table: "textbooks",
    normalize: (row: Record<string, unknown>) =>
      normalizeTextbookManagementRecord(row) as ManagementRow,
    buildStats: (rows: ManagementRow[]) =>
      buildTextbookManagementStats(rows) as ManagementStat[],
  },
} satisfies Record<
  ManagementKind,
  {
    table: string;
    normalize: (row: Record<string, unknown>) => ManagementRow;
    buildStats: (rows: ManagementRow[]) => ManagementStat[];
  }
>;

function textValue(value: unknown) {
  return String(value || "").trim();
}

function normalizePeriodLabel(value: unknown) {
  return textValue(value)
    .replace(/\b(20\d{2})\s+\1(?=\s|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const MANAGEMENT_TABLE_TIMEOUT_MS = 8000;

function isMissingRelationError(error: unknown) {
  const code = String((error as { code?: string })?.code || "").trim();
  const message = String((error as { message?: string })?.message || "").toLowerCase();

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find the table")
  );
}

function isMissingColumnError(error: unknown) {
  const message = String((error as { message?: string })?.message || "").toLowerCase();
  return message.includes("column") &&
    (message.includes("does not exist") || message.includes("schema cache") || message.includes("could not find"));
}

function withTableTimeout<T>(request: PromiseLike<T>, table: string, optional: boolean): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      if (optional) {
        resolve({ data: [], error: null } as T);
        return;
      }

      reject(new Error(`${table} 데이터를 불러오지 못했습니다.`));
    }, MANAGEMENT_TABLE_TIMEOUT_MS);
  });

  return Promise.race([Promise.resolve(request), timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

async function readOptionalTable(table: string, columns = "*") {
  const { data, error } = await withTableTimeout(supabase!.from(table).select(columns), table, true);

  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) {
      return [] as Record<string, unknown>[];
    }
    throw error;
  }

  return (data || []) as unknown as Record<string, unknown>[];
}

async function readActiveScienceSubjectAreas() {
  const { data, error } = await withTableTimeout(
    supabase!.rpc("list_active_science_subject_areas_v1"),
    "list_active_science_subject_areas_v1",
    true,
  );

  if (error) {
    const code = textValue((error as { code?: unknown })?.code);
    if (["42883", "PGRST202"].includes(code) || isMissingRelationError(error)) {
      return [] as Record<string, unknown>[];
    }
    throw error;
  }

  return (data || []) as unknown as Record<string, unknown>[];
}

function listValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(textValue).filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(textValue).filter(Boolean);
      }
    } catch {
      // String arrays may also be stored as comma-separated IDs.
    }

    return trimmed.split(",").map(textValue).filter(Boolean);
  }

  return [];
}

function toClassStudentSummary(student: Record<string, unknown> | undefined, id: string) {
  const studentName = textValue(student?.name);
  const recentIssue = textValue(
    student?.recent_issue ||
      student?.recentIssue ||
      student?.latest_issue ||
      student?.latestIssue ||
      student?.special_note ||
      student?.specialNote ||
      student?.important_note ||
      student?.importantNote,
  );

  return {
    id,
    name: studentName || "학생 정보 확인 필요",
    school: textValue(student?.school),
    grade: textValue(student?.grade),
    status: textValue(student?.status),
    contact: textValue(student?.contact || student?.phone || student?.student_contact || student?.studentContact),
    parentContact: textValue(student?.parent_contact || student?.parentContact || student?.guardian_contact || student?.guardianContact),
    counselingNote: textValue(student?.counseling_note || student?.counselingNote || student?.memo || student?.note),
    recentIssue,
  };
}

function attachClassStudentSummaries(
  classRow: Record<string, unknown>,
  studentsById: Map<string, Record<string, unknown>>,
) {
  const registeredIds = listValue(classRow.student_ids || classRow.studentIds);
  const waitlistIds = listValue(
    classRow.waitlist_student_ids ||
      classRow.waitlistStudentIds ||
      classRow.waitlist_ids ||
      classRow.waitlistIds,
  );

  return {
    ...classRow,
    registered_students: registeredIds.map((id) => toClassStudentSummary(studentsById.get(id), id)),
    registeredStudents: registeredIds.map((id) => toClassStudentSummary(studentsById.get(id), id)),
    waitlist_students: waitlistIds.map((id) => toClassStudentSummary(studentsById.get(id), id)),
    waitlistStudents: waitlistIds.map((id) => toClassStudentSummary(studentsById.get(id), id)),
  };
}

function toStudentClassSummary(classRow: Record<string, unknown> | undefined, id: string) {
  return {
    id,
    name: textValue(classRow?.name || classRow?.className || classRow?.class_name) || id,
    subject: textValue(classRow?.subject),
    teacher: textValue(classRow?.teacher || classRow?.teacher_name || classRow?.teacherName),
    classroom: textValue(classRow?.classroom || classRow?.room),
    schedule: textValue(classRow?.schedule),
  };
}

function attachStudentClassSummaries(
  studentRow: Record<string, unknown>,
  classesById: Map<string, Record<string, unknown>>,
) {
  const enrolledIds = listValue(studentRow.class_ids || studentRow.classIds);
  const waitlistIds = listValue(
    studentRow.waitlist_class_ids ||
      studentRow.waitlistClassIds ||
      studentRow.waitlist_ids ||
      studentRow.waitlistIds,
  );

  return {
    ...studentRow,
    enrolled_classes: enrolledIds.map((id) => toStudentClassSummary(classesById.get(id), id)),
    enrolledClasses: enrolledIds.map((id) => toStudentClassSummary(classesById.get(id), id)),
    waitlist_classes: waitlistIds.map((id) => toStudentClassSummary(classesById.get(id), id)),
    waitlistClasses: waitlistIds.map((id) => toStudentClassSummary(classesById.get(id), id)),
  };
}

function groupRowsByKey(rows: Record<string, unknown>[], key: string) {
  return rows.reduce<Map<string, Record<string, unknown>[]>>((result, row) => {
    const id = textValue(row[key]);
    if (!id) {
      return result;
    }
    const current = result.get(id) || [];
    current.push(row);
    result.set(id, current);
    return result;
  }, new Map());
}

function getStudentClassHistoryLabel(action: unknown, nextMode: unknown, previousMode: unknown) {
  const normalizedAction = textValue(action);
  const normalizedNextMode = textValue(nextMode);
  const normalizedPreviousMode = textValue(previousMode);
  const mode = normalizedNextMode || normalizedPreviousMode || normalizedAction;

  if (normalizedAction === "removed") {
    return "연결 해제";
  }
  if (mode === "waitlist") {
    return "대기 등록";
  }
  return "수강 등록";
}

function toStudentClassHistorySummary(
  historyRow: Record<string, unknown>,
  classesById: Map<string, Record<string, unknown>>,
) {
  const classId = textValue(historyRow.class_id || historyRow.classId);
  const classRow = classesById.get(classId);
  return {
    id: textValue(historyRow.id) || `${classId}-${textValue(historyRow.changed_at || historyRow.changedAt)}`,
    classId,
    className: textValue(classRow?.name || classRow?.class_name || classRow?.className) || classId,
    subject: textValue(classRow?.subject),
    teacher: textValue(classRow?.teacher || classRow?.teacher_name || classRow?.teacherName),
    action: textValue(historyRow.action),
    label: getStudentClassHistoryLabel(historyRow.action, historyRow.next_mode || historyRow.nextMode, historyRow.previous_mode || historyRow.previousMode),
    previousMode: textValue(historyRow.previous_mode || historyRow.previousMode),
    nextMode: textValue(historyRow.next_mode || historyRow.nextMode),
    changedAt: textValue(historyRow.changed_at || historyRow.changedAt || historyRow.created_at || historyRow.createdAt),
    memo: textValue(historyRow.memo),
  };
}

function toStudentTextbookHistorySummary(
  saleLine: Record<string, unknown>,
  textbooksById: Map<string, Record<string, unknown>>,
  classesById: Map<string, Record<string, unknown>>,
) {
  const textbookId = textValue(saleLine.textbook_id || saleLine.textbookId);
  const classId = textValue(saleLine.class_id || saleLine.classId);
  const textbook = textbooksById.get(textbookId);
  const classRow = classesById.get(classId);
  return {
    id: textValue(saleLine.id) || `${textbookId}-${classId}-${textValue(saleLine.created_at || saleLine.createdAt)}`,
    textbookId,
    title: textValue(textbook?.title || textbook?.name || saleLine.textbook_title || saleLine.textbookTitle) || textbookId,
    publisher: textValue(textbook?.publisher),
    classId,
    className: textValue(classRow?.name || classRow?.class_name || classRow?.className),
    quantity: Number(saleLine.quantity || 0),
    status: textValue(saleLine.status),
    chargeMonth: textValue(saleLine.charge_month || saleLine.chargeMonth),
    issuedAt: textValue(saleLine.issued_at || saleLine.issuedAt),
    createdAt: textValue(saleLine.created_at || saleLine.createdAt),
  };
}

function attachStudentHistorySummaries(
  studentRow: Record<string, unknown>,
  classHistoryByStudentId: Map<string, Record<string, unknown>[]>,
  textbookHistoryByStudentId: Map<string, Record<string, unknown>[]>,
  classesById: Map<string, Record<string, unknown>>,
  textbooksById: Map<string, Record<string, unknown>>,
) {
  const studentId = textValue(studentRow.id);
  const classHistory = (classHistoryByStudentId.get(studentId) || [])
    .map((historyRow) => toStudentClassHistorySummary(historyRow, classesById))
    .sort((left, right) => right.changedAt.localeCompare(left.changedAt));
  const textbookHistory = (textbookHistoryByStudentId.get(studentId) || [])
    .map((saleLine) => toStudentTextbookHistorySummary(saleLine, textbooksById, classesById))
    .sort((left, right) => (right.issuedAt || right.createdAt).localeCompare(left.issuedAt || left.createdAt));

  return {
    ...studentRow,
    class_history: classHistory,
    classHistory,
    textbook_history: textbookHistory,
    textbookHistory,
  };
}

function toClassGroupSummary(group: Record<string, unknown> | undefined, id: string) {
  const rawName = textValue(group?.name);
  return {
    id,
    name: normalizePeriodLabel(rawName) || id,
    rawName,
    subject: textValue(group?.subject),
    sortOrder: group?.sort_order ?? group?.sortOrder ?? 0,
    isDefault: group?.is_default === true || group?.isDefault === true,
  };
}

function attachClassGroupSummaries(
  classRow: Record<string, unknown>,
  groupsById: Map<string, Record<string, unknown>>,
  membersByClassId: Map<string, string[]>,
) {
  const classId = textValue(classRow.id);
  const groupIds = membersByClassId.get(classId) || [];
  const classGroups = groupIds.map((id) => toClassGroupSummary(groupsById.get(id), id));

  return {
    ...classRow,
    class_group_ids: groupIds,
    classGroupIds: groupIds,
    class_groups: classGroups,
    classGroups,
    class_group_names: classGroups.map((group) => group.name),
    classGroupNames: classGroups.map((group) => group.name),
  };
}

function attachClassCurriculumSummary(
  classRow: Record<string, unknown>,
  curriculumByClassId: Map<string, Record<string, unknown>>,
) {
  const classId = textValue(classRow.id);
  const curriculum = curriculumByClassId.get(classId);
  if (!curriculum) {
    return classRow;
  }

  return {
    ...classRow,
    curriculum_summary: curriculum,
    curriculumSummary: curriculum,
    state_label: curriculum.stateLabel,
    stateLabel: curriculum.stateLabel,
    textbook_count: curriculum.textbookCount,
    textbookCount: curriculum.textbookCount,
    textbook_catalog: curriculum.textbookCatalog,
    textbookCatalog: curriculum.textbookCatalog,
    total_sessions: curriculum.totalSessions,
    totalSessions: curriculum.totalSessions,
    progress_target_sessions: curriculum.progressTargetSessions,
    progressTargetSessions: curriculum.progressTargetSessions,
    planned_progress_sessions: curriculum.plannedProgressSessions,
    plannedProgressSessions: curriculum.plannedProgressSessions,
    delayed_progress_sessions: curriculum.delayedProgressSessions,
    delayedProgressSessions: curriculum.delayedProgressSessions,
    progress_target_percent: curriculum.progressTargetPercent,
    progressTargetPercent: curriculum.progressTargetPercent,
    next_session: curriculum.nextSession,
    nextSession: curriculum.nextSession,
  };
}

async function readOptionalClassAuditLogs() {
  if (!supabase) {
    return [] as Record<string, unknown>[];
  }

  const { data, error } = await withTableTimeout(
    supabase
      .from("dashboard_audit_logs")
      .select("id, actor_profile_id, actor_email, actor_role, action, entity_table, entity_id, entity_label, changed_at")
      .eq("entity_table", "classes")
      .order("changed_at", { ascending: false })
      .limit(300),
    "dashboard_audit_logs",
    true,
  );

  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) {
      return [] as Record<string, unknown>[];
    }
    throw error;
  }

  return (data || []) as unknown as Record<string, unknown>[];
}

function toClassAuditSummary(log: Record<string, unknown>) {
  return {
    id: textValue(log.id),
    action: textValue(log.action),
    actorProfileId: textValue(log.actor_profile_id || log.actorProfileId),
    actorEmail: textValue(log.actor_email || log.actorEmail),
    actorRole: textValue(log.actor_role || log.actorRole),
    changedAt: textValue(log.changed_at || log.changedAt),
  };
}

function attachClassAuditSummary(
  classRow: Record<string, unknown>,
  auditLogsByClassId: Map<string, Record<string, unknown>[]>,
) {
  const classId = textValue(classRow.id);
  const auditLogs = (auditLogsByClassId.get(classId) || []).map(toClassAuditSummary);
  const latestAudit = auditLogs[0];
  const latestChangedAt = textValue(classRow.updated_at || classRow.updatedAt || latestAudit?.changedAt);
  const latestActor = textValue(
    classRow.updated_by_name ||
      classRow.updatedByName ||
      classRow.updated_by ||
      classRow.updatedBy ||
      latestAudit?.actorEmail ||
      latestAudit?.actorRole ||
      latestAudit?.actorProfileId,
  );

  return {
    ...classRow,
    audit_logs: auditLogs,
    auditLogs,
    latest_audit_action: latestAudit?.action || "",
    latestAuditAction: latestAudit?.action || "",
    updated_at: latestChangedAt,
    updatedAt: latestChangedAt,
    updated_by: latestActor,
    updatedBy: latestActor,
    updated_by_name: latestActor,
    updatedByName: latestActor,
  };
}

function normalizeManagementRows(
  kind: ManagementKind,
  sourceRows: Record<string, unknown>[],
) {
  const config = CONFIG[kind];
  return sourceRows
    .map((row) => config.normalize(row))
    .sort((left, right) => left.title.localeCompare(right.title, "ko"));
}

// Kept for the legacy enrichment compatibility helpers exercised by older callers.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function enrichManagementRows(
  kind: ManagementKind,
  initialRows: Record<string, unknown>[],
) {
  let sourceRows = initialRows;
  let classFormReferences = EMPTY_CLASS_FORM_REFERENCES;

  if (kind === "students") {
    const [classes, classHistory, textbookSaleLines, textbooks] = await Promise.all([
      readOptionalTable("classes"),
      readOptionalTable("student_class_enrollment_history"),
      readOptionalTable("textbook_sale_lines"),
      readOptionalTable("textbooks"),
    ]);
    const classesById = new Map(
      classes.map((classRow) => [textValue(classRow.id), classRow]),
    );
    const textbooksById = new Map(
      textbooks.map((textbook) => [textValue(textbook.id), textbook]),
    );
    const classHistoryByStudentId = groupRowsByKey(classHistory, "student_id");
    const textbookHistoryByStudentId = groupRowsByKey(textbookSaleLines, "student_id");

    sourceRows = sourceRows.map((row) =>
      attachStudentHistorySummaries(
        attachStudentClassSummaries(row, classesById),
        classHistoryByStudentId,
        textbookHistoryByStudentId,
        classesById,
        textbooksById,
      ),
    );
  }

  if (kind === "classes") {
    const [students, classGroups, classGroupMembers, classTerms, textbooks, progressLogs, classAuditLogs, teacherCatalogs, classroomCatalogs, scienceSubjectAreas] = await Promise.all([
      readOptionalTable("students"),
      readOptionalTable("class_schedule_sync_groups"),
      readOptionalTable("class_schedule_sync_group_members", "group_id,class_id,sort_order"),
      readOptionalTable("class_terms"),
      readOptionalTable("textbooks"),
      readOptionalTable("progress_logs"),
      readOptionalClassAuditLogs(),
      readOptionalTable("teacher_catalogs", "id,name,subjects,is_visible,sort_order"),
      readOptionalTable("classroom_catalogs", "id,name,subjects,is_visible,sort_order"),
      readActiveScienceSubjectAreas(),
    ]);
    classFormReferences = { teacherCatalogs, classroomCatalogs, scienceSubjectAreas };
    const studentsById = new Map(
      students.map((student) => [textValue(student.id), student]),
    );
    const groupsById = new Map(
      classGroups.map((group) => [textValue(group.id), group]),
    );
    const membersByClassId = classGroupMembers.reduce<Map<string, string[]>>((result, member) => {
      const classId = textValue(member.class_id || member.classId);
      const groupId = textValue(member.group_id || member.groupId);
      if (!classId || !groupId) {
        return result;
      }
      const list = result.get(classId) || [];
      list.push(groupId);
      result.set(classId, list);
      return result;
    }, new Map());
    const curriculumModel = buildCurriculumWorkspaceModel({
      classes: sourceRows,
      classTerms,
      classGroups,
      classGroupMembers,
      textbooks,
      progressLogs,
      filters: {},
    }) as { rows?: Record<string, unknown>[] };
    const curriculumByClassId = new Map(
      (curriculumModel.rows || []).map((row) => [textValue(row.id), row]),
    );
    const auditLogsByClassId = groupRowsByKey(classAuditLogs, "entity_id");

    sourceRows = sourceRows.map((row) =>
      ({
        ...attachClassAuditSummary(
          attachClassCurriculumSummary(
            attachClassGroupSummaries(
              attachClassStudentSummaries(row, studentsById),
              groupsById,
              membersByClassId,
            ),
            curriculumByClassId,
          ),
          auditLogsByClassId,
        ),
        available_class_groups: classGroups.map((group) => toClassGroupSummary(group, textValue(group.id))),
        availableClassGroups: classGroups.map((group) => toClassGroupSummary(group, textValue(group.id))),
        available_teacher_catalogs: teacherCatalogs,
        availableTeacherCatalogs: teacherCatalogs,
        available_classroom_catalogs: classroomCatalogs,
        availableClassroomCatalogs: classroomCatalogs,
        available_science_subject_areas: scienceSubjectAreas,
        availableScienceSubjectAreas: scienceSubjectAreas,
        available_textbooks: textbooks.map((textbook) => ({
          id: textValue(textbook.id),
          title: textValue(textbook.title || textbook.name),
          subject: textValue(textbook.subject),
          school_level: textValue(textbook.school_level),
          grade_level: textValue(textbook.grade_level),
          school_levels: Array.isArray(textbook.school_levels) ? textbook.school_levels : [],
          grade_levels: Array.isArray(textbook.grade_levels) ? textbook.grade_levels : [],
          sub_subject: textValue(textbook.sub_subject),
          subject_area_key: textValue(textbook.subject_area_key),
          publisher: textValue(textbook.publisher),
        })).filter((textbook) => textbook.id && textbook.title),
      }),
    );
  }

  return { sourceRows, classFormReferences };
}

export type ManagementListFilters =
  | { kind: "students"; search: string; status: string | null; schoolCategory: string | null; school: string | null; grade: string | null }
  | { kind: "classes"; search: string; periodId: string | null; status: string | null; subject: string | null; grade: string | null; teacher: string | null; classroom: string | null }
  | { kind: "textbooks"; search: string; status: string | null; subject: string | null; publisher: string | null };

type ManagementPageCursor = { sortKey: string; id: string; scopeHash: string };

export type UseManagementRecordsOptions = {
  pageSize: ManagementListPageSize;
  enabled: boolean;
};

function managementRequestScope(
  kind: ManagementKind,
  filters: ManagementListFilters,
  pageSize: ManagementListPageSize,
  cursor: ManagementPageCursor | null,
) {
  return JSON.stringify([kind, filters, pageSize, cursor]);
}

function isManagementAbortError(error: unknown) {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}

function defaultManagementFilters(kind: ManagementKind): ManagementListFilters {
  if (kind === "students") return { kind, search: "", status: null, schoolCategory: null, school: null, grade: null };
  if (kind === "classes") return { kind, search: "", periodId: null, status: "수강", subject: null, grade: null, teacher: null, classroom: null };
  return { kind, search: "", status: null, subject: null, publisher: null };
}

function aggregateToStats(kind: ManagementKind, aggregate: Record<string, unknown>): ManagementStat[] {
  const total = Number(aggregate.total || 0);
  const byStatus = aggregate.byStatus && typeof aggregate.byStatus === "object" && !Array.isArray(aggregate.byStatus)
    ? aggregate.byStatus as Record<string, unknown>
    : {};
  const primaryLabel = kind === "students" ? "전체 학생" : kind === "classes" ? "전체 수업" : "전체 교재";
  return [
    { label: primaryLabel, value: total.toLocaleString("ko-KR"), hint: "현재 필터 전체" },
    ...Object.entries(byStatus).slice(0, 3).map(([label, value]) => ({
      label,
      value: Number(value || 0).toLocaleString("ko-KR"),
      hint: "서버 집계",
    })),
  ];
}

function relationRows(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const source = value as Record<string, unknown>;
  const page = source.page && typeof source.page === "object" && !Array.isArray(source.page)
    ? source.page as Record<string, unknown>
    : source;
  return Array.isArray(page.rows) ? page.rows as Record<string, unknown>[] : [];
}

function relationPage(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return source.page && typeof source.page === "object" && !Array.isArray(source.page)
    ? source.page as Record<string, unknown>
    : source;
}

function detailToSourceRow(kind: ManagementKind, detail: unknown): Record<string, unknown> | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const source = detail as Record<string, unknown>;
  if (source.kind !== kind || !source.record || typeof source.record !== "object" || Array.isArray(source.record)) return null;
  const record = source.record as Record<string, unknown>;
  if (kind === "students") {
    const enrollments = relationRows(source.enrollments);
    const enrollmentClasses: Record<string, unknown>[] = enrollments.map((row) => ({
      ...row,
      id: row.classId,
      name: row.className,
    }));
    const enrolledClasses = enrollmentClasses.filter((row) => row.status === "enrolled");
    const waitlistClasses = enrollmentClasses.filter((row) => ["waitlist", "waitlisted"].includes(textValue(row.status)));
    return {
      ...record,
      school_category: record.schoolCategory,
      parent_contact: record.parentContact,
      enroll_date: record.enrollDate,
      counseling_note: record.counselingNote,
      recent_issue: record.recentIssue,
      updated_at: record.updatedAt,
      class_ids: enrolledClasses.map((row) => row.id),
      waitlist_class_ids: waitlistClasses.map((row) => row.id),
      enrolled_classes: enrolledClasses,
      enrolledClasses,
      waitlist_classes: waitlistClasses,
      waitlistClasses,
      class_history: relationRows(source.lifecycleHistory),
      classHistory: relationRows(source.lifecycleHistory),
      enrollments_relation_page: relationPage(source.enrollments),
      lifecycle_history_relation_page: relationPage(source.lifecycleHistory),
      class_picker_relation_page: relationPage(source.classPicker),
    };
  }
  if (kind === "classes") {
    const registeredStudents = relationRows(source.registeredStudents);
    const waitlistedStudents = relationRows(source.waitlistedStudents);
    const textbooks = Array.isArray(source.textbooks)
      ? source.textbooks.filter((textbook): textbook is Record<string, unknown> => Boolean(textbook && typeof textbook === "object" && !Array.isArray(textbook)))
      : [];
    const assignedTextbookIds = getAssignedClassTextbookIds(source);
    const schedule = source.schedule && typeof source.schedule === "object" && !Array.isArray(source.schedule)
      ? source.schedule as Record<string, unknown>
      : {};
    const formReferences = source.formReferences && typeof source.formReferences === "object" && !Array.isArray(source.formReferences)
      ? source.formReferences as Record<string, unknown>
      : {};
    return {
      ...record,
      class_type: record.classType,
      subject_area_key: record.subjectAreaKey,
      updated_at: record.updatedAt,
      student_ids: registeredStudents.map((row) => row.id),
      waitlist_ids: waitlistedStudents.map((row) => row.id),
      textbook_ids: assignedTextbookIds,
      textbookIds: assignedTextbookIds,
      registered_students: registeredStudents,
      registeredStudents,
      waitlist_students: waitlistedStudents,
      waitlistStudents: waitlistedStudents,
      registered_students_relation_page: relationPage(source.registeredStudents),
      waitlisted_students_relation_page: relationPage(source.waitlistedStudents),
      schedule_plan: schedule.plan || null,
      schedule_slots: Array.isArray(schedule.slots) ? schedule.slots : [],
      textbooks,
      available_textbooks: textbooks,
      class_groups: Array.isArray(source.groups) ? source.groups : [],
      available_teacher_catalogs: Array.isArray(formReferences.teacherCatalogs) ? formReferences.teacherCatalogs : [],
      available_classroom_catalogs: Array.isArray(formReferences.classroomCatalogs) ? formReferences.classroomCatalogs : [],
      available_science_subject_areas: Array.isArray(formReferences.scienceSubjectAreas) ? formReferences.scienceSubjectAreas : [],
    };
  }
  return {
    ...record,
    updated_at: record.updatedAt,
    school_levels: (source.taxonomy as Record<string, unknown> | undefined)?.schoolLevels || [],
    grade_levels: (source.taxonomy as Record<string, unknown> | undefined)?.gradeLevels || [],
    sub_subject: (source.taxonomy as Record<string, unknown> | undefined)?.subSubject || null,
    active_classes: relationRows(source.activeClasses),
    purchase_history: relationRows(source.purchaseHistory),
    active_classes_relation_page: relationPage(source.activeClasses),
    purchase_history_relation_page: relationPage(source.purchaseHistory),
    progress_summary: source.progressSummary || {},
  };
}

function listRowToSource(kind: ManagementKind, row: Record<string, unknown>) {
  if (kind === "students") return { ...row, updated_at: row.updatedAt };
  if (kind === "classes") return { ...row, teacher_name: row.teacherName, student_count: row.studentCount, updated_at: row.updatedAt };
  return { ...row, name: row.title, active_class_count: row.activeClassCount, updated_at: row.updatedAt };
}

export function useManagementRecords(
  kind: ManagementKind,
  requestedFilters?: ManagementListFilters,
  { pageSize, enabled }: UseManagementRecordsOptions = { pageSize: 20, enabled: true },
) {
  const [rows, setRows] = useState<ManagementRow[]>([]);
  const [stats, setStats] = useState<ManagementStat[]>([]);
  const [classFormReferences, setClassFormReferences] = useState<ClassFormReferences>(EMPTY_CLASS_FORM_REFERENCES);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<ManagementPageCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [filterOptions, setFilterOptions] = useState<Record<string, unknown>>({});
  const [effectiveClassPeriodId, setEffectiveClassPeriodId] = useState("");
  const initialRequestGateRef = useRef(createManagementRequestGate());
  const continuationRequestGateRef = useRef(createManagementRequestGate());
  const initialTicketRef = useRef<ManagementRequestTicket | null>(null);
  const canonicalReplayTokenRef = useRef("");
  const filters = useMemo(() => requestedFilters || defaultManagementFilters(kind), [kind, requestedFilters]);
  const effectiveFiltersRef = useRef<ManagementListFilters>(filters);
  const readService = useMemo(() => supabase ? createManagementReadService({ supabase }) : null, []);

  const load = useCallback(async ({ allowCanonicalReplay = false }: { allowCanonicalReplay?: boolean } = {}) => {
    continuationRequestGateRef.current.abort();
    setLoadingMore(false);
    setNextCursor(null);
    setHasMore(false);
    const ticket = initialRequestGateRef.current.begin(
      managementRequestScope(kind, filters, pageSize, null),
    );
    initialTicketRef.current = ticket;

    if (!enabled) {
      setLoading(false);
      return;
    }

    if (!readService) {
      setError("Supabase 연결 설정을 확인해 주세요.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const canonicalReplayToken = allowCanonicalReplay ? canonicalReplayTokenRef.current : "";
      if (!allowCanonicalReplay && canonicalReplayTokenRef.current) {
        readService.discardCanonicalReplay(canonicalReplayTokenRef.current);
      }
      canonicalReplayTokenRef.current = "";
      const result = await readService.loadInitialPage({
        kind,
        filters,
        cursor: null,
        limit: pageSize,
        canonicalReplayToken,
        coalesceInitialRequest: allowCanonicalReplay,
        signal: ticket.signal,
      });
      if (!initialRequestGateRef.current.isCurrent(ticket)) return;
      canonicalReplayTokenRef.current = textValue(result.canonicalReplayToken);
      effectiveFiltersRef.current = result.effectiveFilters as ManagementListFilters;
      setEffectiveClassPeriodId(kind === "classes" ? textValue(result.effectiveFilters.periodId) : "");
      const sourceRows = result.page.rows.map((row: Record<string, unknown>) => listRowToSource(kind, row));
      setRows(normalizeManagementRows(kind, sourceRows));
      setNextCursor(result.page.nextCursor);
      setHasMore(result.page.hasMore);
      setClassFormReferences(EMPTY_CLASS_FORM_REFERENCES);
      setError(null);
      setLoading(false);

      const metadata = await result.metadata;
      if (!initialRequestGateRef.current.isCurrent(ticket)) return;
      if (metadata.ok) {
        setStats(aggregateToStats(kind, metadata.stats));
        setFilterOptions(metadata.filterOptions);
      } else if (!isManagementAbortError(metadata.error)) {
        setError(
          metadata.error instanceof Error
            ? metadata.error.message
            : "목록 부가 정보를 불러오지 못했습니다.",
        );
      }
    } catch (fetchError) {
      if (initialRequestGateRef.current.isCurrent(ticket) && !isManagementAbortError(fetchError)) {
        setError(
          fetchError instanceof Error ? fetchError.message : "알 수 없는 연결 오류가 발생했습니다.",
        );
        setLoading(false);
      }
    }
  }, [enabled, filters, kind, pageSize, readService]);

  useEffect(() => {
    const initialRequestGate = initialRequestGateRef.current;
    const continuationRequestGate = continuationRequestGateRef.current;
    void load({ allowCanonicalReplay: true });
    return () => {
      initialRequestGate.abort();
      continuationRequestGate.abort();
      initialTicketRef.current = null;
    };
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!enabled || !readService || !nextCursor || !hasMore || loadingMore) return;
    const initialTicket = initialTicketRef.current;
    if (!initialTicket || !initialRequestGateRef.current.isCurrent(initialTicket)) return;
    const ticket = continuationRequestGateRef.current.begin(
      managementRequestScope(kind, effectiveFiltersRef.current, pageSize, nextCursor),
    );
    setLoadingMore(true);
    try {
      const page = await readService.loadNextPage({
        kind,
        filters: effectiveFiltersRef.current,
        cursor: nextCursor,
        limit: pageSize,
        signal: ticket.signal,
      });
      if (
        !continuationRequestGateRef.current.isCurrent(ticket)
        || initialTicketRef.current !== initialTicket
        || !initialRequestGateRef.current.isCurrent(initialTicket)
      ) return;
      const incoming = normalizeManagementRows(kind, page.rows.map((row: Record<string, unknown>) => listRowToSource(kind, row)));
      setRows((current) => {
        const byId = new Map(current.map((row) => [row.id, row]));
        for (const row of incoming) byId.set(row.id, row);
        return [...byId.values()];
      });
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (fetchError) {
      if (
        continuationRequestGateRef.current.isCurrent(ticket)
        && initialTicketRef.current === initialTicket
        && initialRequestGateRef.current.isCurrent(initialTicket)
        && !isManagementAbortError(fetchError)
      ) {
        setError(fetchError instanceof Error ? fetchError.message : "다음 목록을 불러오지 못했습니다.");
      }
    } finally {
      if (continuationRequestGateRef.current.isCurrent(ticket)) {
        setLoadingMore(false);
      }
    }
  }, [enabled, hasMore, kind, loadingMore, nextCursor, pageSize, readService]);

  const loadDetail = useCallback(async (id: string) => {
    if (!readService) return null;
    const detail = await readService.loadDetail({ kind, id });
    const sourceRow = detailToSourceRow(kind, detail);
    if (!sourceRow) return null;
    if (kind === "classes") {
      setClassFormReferences({
        teacherCatalogs: Array.isArray(sourceRow.available_teacher_catalogs) ? sourceRow.available_teacher_catalogs as Record<string, unknown>[] : [],
        classroomCatalogs: Array.isArray(sourceRow.available_classroom_catalogs) ? sourceRow.available_classroom_catalogs as Record<string, unknown>[] : [],
        scienceSubjectAreas: Array.isArray(sourceRow.available_science_subject_areas) ? sourceRow.available_science_subject_areas as Record<string, unknown>[] : [],
      });
    }
    return normalizeManagementRows(kind, [sourceRow])[0] || null;
  }, [kind, readService]);

  const loadRelationPage = useCallback(async ({
    id,
    relationKind,
    cursor,
  }: {
    id: string;
    relationKind: string;
    cursor: string;
  }) => {
    if (!readService) return null;
    return readService.loadRelationPage({ kind, id, relationKind, cursor, limit: 30 });
  }, [kind, readService]);

  const loadClassRosterPreview = useCallback(async ({
    classId,
    mode,
  }: {
    classId: string;
    mode: "registered" | "waitlist";
  }) => {
    if (!readService || kind !== "classes") return [] as Record<string, unknown>[];
    const result = await readService.loadRelationPage({
      kind: "classes",
      id: classId,
      relationKind: mode === "registered" ? "registered_students" : "waitlisted_students",
      cursor: null,
      limit: 30,
    });
    return relationRows(result);
  }, [kind, readService]);

  const loadClassTextbookCandidatePage = useCallback(async ({
    classId,
    search,
    filters,
    cursor,
  }: {
    classId: string;
    search: string;
    filters: { subject: string; schoolLevel: string; gradeLevel: string; subSubject: string };
    cursor: ManagementPageCursor | null;
  }) => {
    if (!readService) return null;
    return readService.searchClassTextbookCandidates({ classId, search, filters, cursor, limit: 30 });
  }, [readService]);

  const reloadRow = useCallback(async (id: string) => {
    const detailRow = await loadDetail(id);
    if (!detailRow) return null;
    setRows((current) => current.some((row) => row.id === id)
      ? current.map((row) => row.id === id ? detailRow : row)
      : [detailRow, ...current]);
    return detailRow;
  }, [loadDetail]);

  const removeRows = useCallback((ids: string[]) => {
    const removed = new Set(ids);
    setRows((current) => current.filter((row) => !removed.has(row.id)));
  }, []);

  const refresh = useCallback(() => load({ allowCanonicalReplay: false }), [load]);

  return {
    rows,
    stats,
    loading,
    error,
    classFormReferences,
    filterOptions,
    effectiveClassPeriodId,
    hasMore,
    loadingMore,
    loadMore,
    loadDetail,
    loadRelationPage,
    loadClassRosterPreview,
    loadClassTextbookCandidatePage,
    reloadRow,
    removeRows,
    refresh,
  };
}
