"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/lib/supabase";

import { createId, managementService } from "./management-service.js";
import {
  SettingsMasterHeader,
  SettingsTableFrame,
  settingsTableCellClass,
  settingsTableHeadClass,
} from "./settings-master-layout";
import { useSettingsTableColumns, type SettingsTableColumn } from "./settings-table-columns";

type TermRecord = {
  id: string;
  academicYear: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
  sortOrder: string;
  isNew?: boolean;
};

const TERM_TABLE_COLUMNS = [
  { id: "academicYear", label: "학년도" },
  { id: "name", label: "학기명" },
  { id: "status", label: "상태" },
  { id: "startDate", label: "시작일" },
  { id: "endDate", label: "종료일" },
  { id: "action", label: "작업", required: true },
] satisfies SettingsTableColumn[];

function toTermRecord(row: Record<string, unknown>, index: number): TermRecord {
  return {
    id: String(row.id || createId()),
    academicYear: String(row.academic_year ?? new Date().getFullYear()),
    name: typeof row.name === "string" ? row.name : "",
    status: typeof row.status === "string" ? row.status : "수강",
    startDate: typeof row.start_date === "string" ? row.start_date : "",
    endDate: typeof row.end_date === "string" ? row.end_date : "",
    sortOrder: String(row.sort_order ?? index),
  };
}

function createEmptyTerm(nextSortOrder: number): TermRecord {
  return {
    id: createId(),
    academicYear: String(new Date().getFullYear()),
    name: "",
    status: "수강",
    startDate: "",
    endDate: "",
    sortOrder: String(nextSortOrder),
    isNew: true,
  };
}

export function TermMasterWorkspace() {
  const [rows, setRows] = useState<TermRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const { isColumnVisible, visibleColumnCount, columnSettingsControl } = useSettingsTableColumns(
    "tips-settings-table:terms:v1",
    TERM_TABLE_COLUMNS,
  );

  const loadTerms = useCallback(async () => {
    if (!supabase) {
      setRows([]);
      setError(managementService.configError || "Supabase 연결 설정을 확인해 주세요.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from("class_terms")
        .select("id, academic_year, name, status, start_date, end_date, sort_order")
        .order("academic_year", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (queryError) {
        throw queryError;
      }

      setRows((data || []).map((row, index) => toTermRecord(row as Record<string, unknown>, index + 1)));
      setDeletedIds([]);
      setIsDirty(false);
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "학기 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTerms();
  }, [loadTerms]);

  const nextSortOrder = useMemo(() => {
    const numericSortOrders = rows
      .map((row) => Number.parseInt(row.sortOrder, 10))
      .filter((value) => Number.isFinite(value));
    return (numericSortOrders.length > 0 ? Math.max(...numericSortOrders) : 0) + 1;
  }, [rows]);

  const handleFieldChange = (id: string, field: keyof TermRecord, value: string) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setIsDirty(true);
  };

  const handleAdd = () => {
    setRows((current) => [createEmptyTerm(nextSortOrder), ...current]);
    setIsDirty(true);
  };

  const handleSaveAll = async () => {
    const nextRows = rows.map((row, index) => ({
      ...row,
      name: row.name.trim(),
      status: row.status.trim() || "수강",
      sortOrder: String(index + 1),
    }));
    if (nextRows.some((row) => !row.name)) {
      setError("학기명을 입력하지 않은 행이 있습니다.");
      return;
    }

    if (nextRows.some((row) => !Number.isFinite(Number.parseInt(row.academicYear, 10)))) {
      setError("학년도는 숫자로 입력해 주세요.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (deletedIds.length > 0) {
        await managementService.deleteClassTerm(deletedIds);
      }
      if (nextRows.length > 0) {
        await managementService.upsertClassTerms(
          nextRows.map((row, index) => ({
            id: row.id,
            academicYear: Number.parseInt(row.academicYear, 10),
            name: row.name,
            status: row.status,
            startDate: row.startDate,
            endDate: row.endDate,
            sortOrder: index + 1,
          })),
        );
      }
      await loadTerms();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "학기 정보를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (row: TermRecord) => {
    if (!row.isNew) {
      setDeletedIds((current) => (current.includes(row.id) ? current : [...current, row.id]));
    }
    setRows((current) => current.filter((item) => item.id !== row.id).map((item, index) => ({ ...item, sortOrder: String(index + 1) })));
    setIsDirty(true);
  };

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
      <SettingsMasterHeader
        actions={
          <>
            <Button type="button" size="sm" className="h-9" onClick={handleAdd}>
              <Plus className="mr-2 size-4" />
              학기 추가
            </Button>
            <Button type="button" size="sm" className="h-9" onClick={() => void handleSaveAll()} disabled={!isDirty || saving}>
              {saving ? "저장 중" : "변경 저장"}
            </Button>
            {columnSettingsControl}
          </>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <SettingsTableFrame>
        <Table className="table-fixed">
          <caption className="sr-only">학기 마스터 목록</caption>
          <TableHeader>
            <TableRow>
              {isColumnVisible("academicYear") ? <TableHead className={`w-[10%] ${settingsTableHeadClass}`}>학년도</TableHead> : null}
              {isColumnVisible("name") ? <TableHead className={`w-[20%] ${settingsTableHeadClass}`}>학기명</TableHead> : null}
              {isColumnVisible("status") ? <TableHead className={`w-[16%] ${settingsTableHeadClass}`}>상태</TableHead> : null}
              {isColumnVisible("startDate") ? <TableHead className={`w-[16%] ${settingsTableHeadClass}`}>시작일</TableHead> : null}
              {isColumnVisible("endDate") ? <TableHead className={`w-[16%] ${settingsTableHeadClass}`}>종료일</TableHead> : null}
              {isColumnVisible("action") ? <TableHead className={`w-[22%] text-right ${settingsTableHeadClass}`}>작업</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <TableRow key={`term-loading-${index}`}>
                  <TableCell colSpan={visibleColumnCount} className="px-3 py-2">
                    <Skeleton className="h-10 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  등록된 학기가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                return (
                  <TableRow key={row.id}>
                    {isColumnVisible("academicYear") ? <TableCell className={settingsTableCellClass}>
                      <Input
                        name="term-academic-year"
                        className="h-9"
                        inputMode="numeric"
                        value={row.academicYear}
                        onChange={(event) => handleFieldChange(row.id, "academicYear", event.target.value)}
                        placeholder="2026"
                      />
                    </TableCell> : null}
                    {isColumnVisible("name") ? <TableCell className={settingsTableCellClass}>
                      <Input
                        name="term-name"
                        className="h-9"
                        value={row.name}
                        onChange={(event) => handleFieldChange(row.id, "name", event.target.value)}
                        placeholder="1학기"
                      />
                    </TableCell> : null}
                    {isColumnVisible("status") ? <TableCell className={settingsTableCellClass}>
                      <Input
                        name="term-status"
                        className="h-9"
                        value={row.status}
                        onChange={(event) => handleFieldChange(row.id, "status", event.target.value)}
                        placeholder="수강"
                      />
                    </TableCell> : null}
                    {isColumnVisible("startDate") ? <TableCell className={settingsTableCellClass}>
                      <Input
                        name="term-start-date"
                        className="h-9"
                        type="date"
                        value={row.startDate}
                        onChange={(event) => handleFieldChange(row.id, "startDate", event.target.value)}
                      />
                    </TableCell> : null}
                    {isColumnVisible("endDate") ? <TableCell className={settingsTableCellClass}>
                      <Input
                        name="term-end-date"
                        className="h-9"
                        type="date"
                        value={row.endDate}
                        onChange={(event) => handleFieldChange(row.id, "endDate", event.target.value)}
                      />
                    </TableCell> : null}
                    {isColumnVisible("action") ? <TableCell className={settingsTableCellClass}>
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => handleDelete(row)} disabled={saving} aria-label="학기 삭제">
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell> : null}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </SettingsTableFrame>
    </div>
  );
}
