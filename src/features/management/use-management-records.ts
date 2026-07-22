"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

export function useManagementRecords(kind: ManagementKind) {
  const [rows, setRows] = useState<ManagementRow[]>([]);
  const [classFormReferences, setClassFormReferences] = useState<ClassFormReferences>(EMPTY_CLASS_FORM_REFERENCES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const config = CONFIG[kind];

    if (!supabase) {
      setRows([]);
      setClassFormReferences(EMPTY_CLASS_FORM_REFERENCES);
      setError("Supabase 연결 설정을 확인해 주세요.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (kind !== "classes") {
        setClassFormReferences(EMPTY_CLASS_FORM_REFERENCES);
      }
      const { data, error: queryError } = await withTableTimeout(
        supabase.from(config.table).select("*"),
        config.table,
        false,
      );

      if (queryError) {
        throw queryError;
      }

      let sourceRows = (data || []) as Record<string, unknown>[];

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
        setClassFormReferences({ teacherCatalogs, classroomCatalogs, scienceSubjectAreas });
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

      const nextRows = sourceRows
        .map((row) => config.normalize(row as Record<string, unknown>))
        .sort((left, right) => left.title.localeCompare(right.title, "ko"));

      setRows(nextRows);
      setError(null);
    } catch (fetchError) {
      setRows([]);
      if (kind === "classes") {
        setClassFormReferences(EMPTY_CLASS_FORM_REFERENCES);
      }
      setError(
        fetchError instanceof Error ? fetchError.message : "알 수 없는 연결 오류가 발생했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => CONFIG[kind].buildStats(rows), [kind, rows]);

  return {
    rows,
    stats,
    loading,
    error,
    classFormReferences,
    refresh: load,
  };
}
