"use client";

import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

type AcademicWorkspaceRow = Record<string, unknown>;

type AcademicOperationImpactTask = {
  id: string;
  title: string;
  type: string;
  status: string;
  classId: string;
  className: string;
  studentName: string;
  dueAt: string;
  updatedAt: string;
  registrationClassStartDate: string;
  registrationClassStartSession: string;
  registrationPipelineStatus: string;
  withdrawalDate: string;
  withdrawalSession: string;
  fromClassId: string;
  fromClassName: string;
  fromClassEndDate: string;
  fromClassEndSession: string;
  toClassId: string;
  toClassName: string;
  toClassStartDate: string;
  toClassStartSession: string;
};

type AcademicWorkspaceData = {
  classes: AcademicWorkspaceRow[];
  classTerms: AcademicWorkspaceRow[];
  classGroups: AcademicWorkspaceRow[];
  classGroupMembers: AcademicWorkspaceRow[];
  textbooks: AcademicWorkspaceRow[];
  progressLogs: AcademicWorkspaceRow[];
  teacherCatalogs: AcademicWorkspaceRow[];
  classroomCatalogs: AcademicWorkspaceRow[];
  operationTasks: AcademicOperationImpactTask[];
};

const EMPTY_DATA: AcademicWorkspaceData = {
  classes: [],
  classTerms: [],
  classGroups: [],
  classGroupMembers: [],
  textbooks: [],
  progressLogs: [],
  teacherCatalogs: [],
  classroomCatalogs: [],
  operationTasks: [],
};

const ACADEMIC_TABLE_TIMEOUT_MS = 8000;

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
        resolve([] as T);
        return;
      }

      reject(new Error(`${table} 데이터를 불러오지 못했습니다.`));
    }, ACADEMIC_TABLE_TIMEOUT_MS);
  });

  return Promise.race([Promise.resolve(request), timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

async function readTable(table: string, optional = false) {
  const { data, error } = await withTableTimeout(supabase!.from(table).select("*"), table, optional);

  if (error) {
    if (optional && isMissingRelationError(error)) {
      return [];
    }

    throw error;
  }

  return data || [];
}

async function readOptionalTable(table: string) {
  try {
    return await readTable(table, true);
  } catch {
    return [];
  }
}

function text(value: unknown) {
  return String(value || "").trim();
}

function byTaskId(rows: AcademicWorkspaceRow[]) {
  const entries: Array<[string, AcademicWorkspaceRow]> = [];
  rows.forEach((row) => {
    const taskId = text(row.task_id);
    if (taskId) entries.push([taskId, row]);
  });
  return new Map(entries);
}

async function readOperationImpactTasks(): Promise<AcademicOperationImpactTask[]> {
  const taskRows = await readOptionalTable("ops_tasks");
  const operationRows = taskRows.filter((row) => ["registration", "transfer", "withdrawal"].includes(text(row.type)));
  if (operationRows.length === 0) return [];

  const [registrationRows, withdrawalRows, transferRows] = await Promise.all([
    readOptionalTable("ops_registration_details"),
    readOptionalTable("ops_withdrawal_details"),
    readOptionalTable("ops_transfer_details"),
  ]);
  const registrationByTaskId = byTaskId(registrationRows);
  const withdrawalByTaskId = byTaskId(withdrawalRows);
  const transferByTaskId = byTaskId(transferRows);

  return operationRows.map((row) => {
    const taskId = text(row.id);
    const registration = registrationByTaskId.get(taskId) || {};
    const withdrawal = withdrawalByTaskId.get(taskId) || {};
    const transfer = transferByTaskId.get(taskId) || {};

    return {
      id: taskId,
      title: text(row.title),
      type: text(row.type),
      status: text(row.status),
      classId: text(row.class_id),
      className: text(row.class_name),
      studentName: text(row.student_name),
      dueAt: text(row.due_at),
      updatedAt: text(row.updated_at),
      registrationClassStartDate: text(registration.class_start_date),
      registrationClassStartSession: text(registration.class_start_session),
      registrationPipelineStatus: text(registration.pipeline_status),
      withdrawalDate: text(withdrawal.withdrawal_date),
      withdrawalSession: text(withdrawal.withdrawal_session),
      fromClassId: text(transfer.from_class_id),
      fromClassName: text(transfer.from_class_name),
      fromClassEndDate: text(transfer.from_class_end_date),
      fromClassEndSession: text(transfer.from_class_end_session),
      toClassId: text(transfer.to_class_id),
      toClassName: text(transfer.to_class_name),
      toClassStartDate: text(transfer.to_class_start_date),
      toClassStartSession: text(transfer.to_class_start_session),
    };
  });
}

export function useAcademicWorkspaceData() {
  const [data, setData] = useState<AcademicWorkspaceData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) {
      setData(EMPTY_DATA);
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [
        classes,
        classTerms,
        classGroups,
        classGroupMembers,
        textbooks,
        progressLogs,
        teacherCatalogs,
        classroomCatalogs,
        operationTasks,
      ] = await Promise.all([
        readTable("classes"),
        readTable("class_terms", true),
        readTable("class_schedule_sync_groups", true),
        readTable("class_schedule_sync_group_members", true),
        readTable("textbooks"),
        readTable("progress_logs"),
        readTable("teacher_catalogs", true),
        readTable("classroom_catalogs", true),
        readOperationImpactTasks(),
      ]);

      setData({
        classes,
        classTerms,
        classGroups,
        classGroupMembers,
        textbooks,
        progressLogs,
        teacherCatalogs,
        classroomCatalogs,
        operationTasks,
      });
      setError(null);
    } catch (fetchError) {
      setData(EMPTY_DATA);
      setError(
        fetchError instanceof Error ? fetchError.message : "Unknown error",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    data,
    loading,
    error,
    refresh: load,
  };
}
