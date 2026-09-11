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
import { collectClassGroupPages, sortClassGroupRows } from "./class-group-pagination";
import {
  SettingsMasterHeader,
  SettingsTableFrame,
  SettingsWorkspaceShell,
  settingsTableActionCellClass,
  settingsTableActionHeadClass,
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
  { id: "name", label: "그룹명" },
  { id: "subject", label: "과목" },
  { id: "action", label: "작업", required: true },
] satisfies SettingsTableColumn[];

const CLASS_GROUP_PAGE_SIZE = 30;

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

export function ClassGroupMasterWorkspace() {
  const [rows, setRows] = useState<ClassGroupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const { isColumnVisible, visibleColumnCount, columnSettingsControl } = useSettingsTableColumns(
    "tips-settings-table:class-groups:v3",
    CLASS_GROUP_TABLE_COLUMNS,
  );

  const loadGroups = useCallback(async () => {
    if (!supabase) {
      setRows([]);
      setError(managementService.configError || "Supabase 연결 설정을 확인해 주세요.");
      setLoading(false);
      return;
    }
    const client = supabase;

    setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await collectClassGroupPages(async (afterId) => {
        return client
          .from("class_schedule_sync_groups")
          .select("id, name, subject, sort_order, is_default")
          .or(afterId ? `id.gt.${afterId}` : "id.not.is.null")
          .order("id", { ascending: true })
          .limit(30)
          .abortSignal(AbortSignal.timeout(8_000))
          .retry(false);
      }, CLASS_GROUP_PAGE_SIZE);

      if (queryError) {
        const message = String(queryError.message || "");
        if (!message.includes("sort_order") && !message.includes("is_default")) {
          throw queryError;
        }

        const { data: fallbackData, error: fallbackError } = await collectClassGroupPages(async (afterId) => {
          return client
            .from("class_schedule_sync_groups")
            .select("id, name, subject")
            .or(afterId ? `id.gt.${afterId}` : "id.not.is.null")
            .order("id", { ascending: true })
            .limit(30)
            .abortSignal(AbortSignal.timeout(8_000))
            .retry(false);
        }, CLASS_GROUP_PAGE_SIZE);

        if (fallbackError) {
          throw fallbackError;
        }

        setRows(sortClassGroupRows(fallbackData || [], false).map((row, index) => toClassGroupRecord(row, index + 1)));
        setDeletedIds([]);
        setIsDirty(false);
        return;
      }

      setRows(sortClassGroupRows(data || [], true).map((row, index) => toClassGroupRecord(row, index + 1)));
      setDeletedIds([]);
      setIsDirty(false);
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "수업그룹 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

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
      setError("그룹명을 입력하지 않은 행이 있습니다.");
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

      await loadGroups();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "수업그룹을 저장하지 못했습니다.");
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

  return (
    <SettingsWorkspaceShell>
      <SettingsMasterHeader
        actions={
          <>
            <Button type="button" size="sm" className="h-9" onClick={handleAdd}>
              <Plus className="mr-2 size-4" />
              그룹 추가
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

      <div data-testid="class-group-settings-mobile-list" className="grid gap-2 md:hidden">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={`class-group-mobile-loading-${index}`} className="rounded-md border p-3">
              <Skeleton className="h-20 w-full" />
            </div>
          ))
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            등록된 수업그룹이 없습니다.
          </div>
        ) : (
          rows.map((row) => (
            <article
              key={row.id}
              data-testid={`class-group-settings-mobile-card-${row.id}`}
              className={row.isNew ? "rounded-md border border-primary/30 bg-primary/5 p-3" : "rounded-md border bg-background p-3"}
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      name="class-group-name"
                      className="h-9"
                      value={row.name}
                      onChange={(event) => handleFieldChange(row.id, "name", event.target.value)}
                      placeholder="예: 중2 수학 진도 그룹"
                    />
                  </div>
                  <Button type="button" variant="destructive-ghost" size="icon" className="size-8 shrink-0" onClick={() => handleDelete(row)} disabled={saving} aria-label="수업그룹 삭제">
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <Input
                  name="class-group-subject"
                  className="h-9"
                  value={row.subject}
                  onChange={(event) => handleFieldChange(row.id, "subject", event.target.value)}
                  placeholder="과목 (선택)"
                />
              </div>
            </article>
          ))
        )}
      </div>

      <div className="hidden md:block">
      <SettingsTableFrame>
        <Table className="table-fixed">
          <caption className="sr-only">수업그룹 목록</caption>
          <TableHeader>
            <TableRow>
              {isColumnVisible("name") ? <TableHead className={`w-[46%] ${settingsTableHeadClass}`}>그룹명</TableHead> : null}
              {isColumnVisible("subject") ? <TableHead className={`w-[34%] ${settingsTableHeadClass}`}>과목</TableHead> : null}
              {isColumnVisible("action") ? <TableHead className={`w-[20%] ${settingsTableActionHeadClass}`}>작업</TableHead> : null}
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
                  등록된 수업그룹이 없습니다.
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
                        placeholder="예: 중2 수학 진도 그룹"
                      />
                    </TableCell> : null}
                    {isColumnVisible("subject") ? <TableCell className={settingsTableCellClass}>
                      <Input
                        name="class-group-subject"
                        className="h-9"
                        value={row.subject}
                        onChange={(event) => handleFieldChange(row.id, "subject", event.target.value)}
                        placeholder="과목 (선택)"
                      />
                    </TableCell> : null}
                    {isColumnVisible("action") ? <TableCell className={settingsTableActionCellClass}>
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="destructive-ghost" size="icon" className="size-8" onClick={() => handleDelete(row)} disabled={saving} aria-label="수업그룹 삭제">
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
    </SettingsWorkspaceShell>
  );
}
