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
    if (isMissingRelationError(error)) {
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
  return {
    id,
    name: textValue(student?.name) || id,
    school: textValue(student?.school),
    grade: textValue(student?.grade),
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

export function useManagementRecords(kind: ManagementKind) {
  const [rows, setRows] = useState<ManagementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const config = CONFIG[kind];

    if (!supabase) {
      setRows([]);
      setError("Supabase 연결 설정을 확인해 주세요.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
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
        const classes = await readOptionalTable("classes");
        const classesById = new Map(
          classes.map((classRow) => [textValue(classRow.id), classRow]),
        );

        sourceRows = sourceRows.map((row) => attachStudentClassSummaries(row, classesById));
      }

      if (kind === "classes") {
        const [students, classGroups, classGroupMembers] = await Promise.all([
          readOptionalTable("students", "id,name,school,grade"),
          readOptionalTable("class_schedule_sync_groups", "id,name,subject"),
          readOptionalTable("class_schedule_sync_group_members", "group_id,class_id,sort_order"),
        ]);
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

        sourceRows = sourceRows.map((row) =>
          ({
            ...attachClassGroupSummaries(
            attachClassStudentSummaries(row, studentsById),
            groupsById,
            membersByClassId,
            ),
            available_class_groups: classGroups.map((group) => toClassGroupSummary(group, textValue(group.id))),
            availableClassGroups: classGroups.map((group) => toClassGroupSummary(group, textValue(group.id))),
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
    refresh: load,
  };
}
