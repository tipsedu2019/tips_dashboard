"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/lib/supabase";

import { createId, managementService } from "./management-service.js";
import { readDefaultPeriodPreference, writeDefaultPeriodPreference } from "./period-preferences";
import {
  SettingsMasterHeader,
  SettingsTableFrame,
  settingsTableCellClass,
  settingsTableHeadClass,
} from "./settings-master-layout";
import { useSettingsTableColumns, type SettingsTableColumn } from "./settings-table-columns";

type ClassGroupRecord = {
  id: string;
  name: string;
  subject: string;
  sortOrder: string;
  isDefault: boolean;
  isNew?: boolean;
};

const CLASS_GROUP_TABLE_COLUMNS = [
  { id: "name", label: "기간명" },
  { id: "default", label: "기본값" },
  { id: "action", label: "작업", required: true },
] satisfies SettingsTableColumn[];

function text(value: unknown) {
  return String(value || "").trim();
}

function toClassGroupRecord(row: Record<string, unknown>, index: number): ClassGroupRecord {
  return {
    id: text(row.id) || createId(),
    name: text(row.name),
    subject: text(row.subject),
    sortOrder: String(row.sort_order ?? row.sortOrder ?? index),
    isDefault: row.is_default === true || row.isDefault === true,
  };
}

function createEmptyClassGroup(nextSortOrder: number): ClassGroupRecord {
  return {
    id: createId(),
    name: "",
    subject: "",
    sortOrder: String(nextSortOrder),
    isDefault: false,
    isNew: true,
  };
}

function applyDefaultPreference(rows: ClassGroupRecord[]) {
  if (rows.some((row) => row.isDefault)) {
    return rows;
  }

  const preference = readDefaultPeriodPreference();
  if (!preference.id && !preference.name) {
    return rows;
  }

  return rows.map((row) => ({
    ...row,
    isDefault: row.id === preference.id || row.name === preference.name,
  }));
}

export function ClassGroupMasterWorkspace() {
  const [rows, setRows] = useState<ClassGroupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const { isColumnVisible, visibleColumnCount, columnSettingsControl } = useSettingsTableColumns(
    "tips-settings-table:periods:v2",
    CLASS_GROUP_TABLE_COLUMNS,
  );

  const loadGroups = useCallback(async () => {
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
        .from("class_schedule_sync_groups")
        .select("id, name, subject, sort_order, is_default")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (queryError) {
        const message = String(queryError.message || "");
        if (!message.includes("sort_order") && !message.includes("is_default")) {
          throw queryError;
        }

        const { data: fallbackData, error: fallbackError } = await supabase
          .from("class_schedule_sync_groups")
          .select("id, name, subject")
          .order("name", { ascending: true });

        if (fallbackError) {
          throw fallbackError;
        }

        setRows(applyDefaultPreference((fallbackData || []).map((row, index) => toClassGroupRecord(row as Record<string, unknown>, index + 1))));
        setDeletedIds([]);
        setIsDirty(false);
        return;
      }

      setRows(applyDefaultPreference((data || []).map((row, index) => toClassGroupRecord(row as Record<string, unknown>, index + 1))));
      setDeletedIds([]);
      setIsDirty(false);
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "기간 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    const defaultRow = rows.find((row) => row.isDefault);
    if (defaultRow) {
      writeDefaultPeriodPreference({ id: defaultRow.id, name: defaultRow.name });
    }
  }, [rows]);

  const nextSortOrder = useMemo(() => {
    const numericSortOrders = rows
      .map((row) => Number.parseInt(row.sortOrder, 10))
      .filter((value) => Number.isFinite(value));
    return (numericSortOrders.length > 0 ? Math.max(...numericSortOrders) : 0) + 1;
  }, [rows]);

  const handleFieldChange = (id: string, field: keyof ClassGroupRecord, value: string) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setIsDirty(true);
  };

  const handleAdd = () => {
    setRows((current) => [createEmptyClassGroup(nextSortOrder), ...current]);
    setIsDirty(true);
  };

  const handleSaveAll = async () => {
    const nextRows = rows.map((row, index) => ({
      ...row,
      name: row.name.trim(),
      sortOrder: String(index + 1),
    }));
    if (nextRows.some((row) => !row.name)) {
      setError("기간명을 입력하지 않은 행이 있습니다.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (deletedIds.length > 0) {
        await managementService.deleteClassGroup(deletedIds);
      }
      if (nextRows.length > 0) {
        await managementService.upsertClassGroups(
          nextRows.map((row, index) => ({
            id: row.id,
            name: row.name,
            subject: row.subject,
            sortOrder: index + 1,
            isDefault: row.isDefault,
          })),
        );
      }

      const defaultRow = nextRows.find((row) => row.isDefault);
      if (defaultRow) {
        await managementService.setDefaultClassGroup(defaultRow.id);
        writeDefaultPeriodPreference({ id: defaultRow.id, name: defaultRow.name });
      }
      await loadGroups();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "기간을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (row: ClassGroupRecord) => {
    if (!row.isNew) {
      setDeletedIds((current) => (current.includes(row.id) ? current : [...current, row.id]));
    }
    setRows((current) => current.filter((item) => item.id !== row.id).map((item, index) => ({ ...item, sortOrder: String(index + 1) })));
    setIsDirty(true);
  };

  const handleSetDefault = (row: ClassGroupRecord) => {
    const name = row.name.trim();
    if (!name) {
      setError("기간명을 입력해 주세요.");
      return;
    }

    setRows((current) => current.map((item) => ({ ...item, isDefault: item.id === row.id })));
    setIsDirty(true);
  };

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
      <SettingsMasterHeader
        actions={
          <>
            <Button type="button" size="sm" className="h-9" onClick={handleAdd}>
              <Plus className="mr-2 size-4" />
              기간 추가
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
          <caption className="sr-only">기간 목록</caption>
          <TableHeader>
            <TableRow>
              {isColumnVisible("name") ? <TableHead className={`w-[52%] ${settingsTableHeadClass}`}>기간명</TableHead> : null}
              {isColumnVisible("default") ? <TableHead className={`w-[16%] ${settingsTableHeadClass}`}>기본값</TableHead> : null}
              {isColumnVisible("action") ? <TableHead className={`w-[32%] text-right ${settingsTableHeadClass}`}>작업</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <TableRow key={`class-group-loading-${index}`}>
                  <TableCell colSpan={visibleColumnCount} className="px-3 py-2">
                    <Skeleton className="h-10 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  등록된 기간이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                return (
                  <TableRow key={row.id}>
                    {isColumnVisible("name") ? <TableCell className={settingsTableCellClass}>
                      <Input
                        name="class-group-name"
                        className="h-9"
                        value={row.name}
                        onChange={(event) => handleFieldChange(row.id, "name", event.target.value)}
                        placeholder="2026 1학기"
                      />
                    </TableCell> : null}
                    {isColumnVisible("default") ? <TableCell className={settingsTableCellClass}>
                      <Button
                        type="button"
                        variant={row.isDefault ? "default" : "outline"}
                        size="sm"
                        className="h-8 w-full justify-center"
                        onClick={() => handleSetDefault(row)}
                        disabled={saving}
                      >
                        {row.isDefault ? <CheckCircle2 className="mr-1.5 size-3.5" /> : null}
                        {row.isDefault ? "기본" : "설정"}
                      </Button>
                    </TableCell> : null}
                    {isColumnVisible("action") ? <TableCell className={settingsTableCellClass}>
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => handleDelete(row)} disabled={saving} aria-label="기간 삭제">
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
