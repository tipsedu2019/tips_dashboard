"use client";

import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

type AcademicWorkspaceRow = Record<string, unknown>;

type AcademicWorkspaceData = {
  classes: AcademicWorkspaceRow[];
  classTerms: AcademicWorkspaceRow[];
  classGroups: AcademicWorkspaceRow[];
  classGroupMembers: AcademicWorkspaceRow[];
  textbooks: AcademicWorkspaceRow[];
  progressLogs: AcademicWorkspaceRow[];
  teacherCatalogs: AcademicWorkspaceRow[];
  classroomCatalogs: AcademicWorkspaceRow[];
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
      ] = await Promise.all([
        readTable("classes"),
        readTable("class_terms", true),
        readTable("class_schedule_sync_groups", true),
        readTable("class_schedule_sync_group_members", true),
        readTable("textbooks"),
        readTable("progress_logs"),
        readTable("teacher_catalogs", true),
        readTable("classroom_catalogs", true),
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
