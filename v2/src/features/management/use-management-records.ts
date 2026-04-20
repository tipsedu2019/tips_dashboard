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
      const { data, error: queryError } = await supabase
        .from(config.table)
        .select("*");

      if (queryError) {
        throw queryError;
      }

      const nextRows = (data || [])
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
