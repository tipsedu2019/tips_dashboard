"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { useDraftNavigation } from "@/hooks/use-draft-navigation";

import { ActionFeedback } from "@/components/ui/action-feedback";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

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
  const { user, canManageAll } = useAuth();
  return <ClassGroupMasterEditor key={user?.id ?? "anonymous"} accessRole={user?.role ?? "viewer"} canEdit={Boolean(canManageAll)} />;
}

function ClassGroupMasterEditor({ canEdit, accessRole }: { canEdit: boolean; accessRole: string }) {
  const [rows, setRows] = useState<ClassGroupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const feedbackFocusRef = useRef<HTMLButtonElement>(null);
  const retryFocusPendingRef = useRef(false);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const savingRef = useRef(false);
  const loadingRef = useRef(true);
  const loadRequestRef = useRef(0);
  const busy = saving || loading;
  const editBlocked = busy || !canEdit;
  const canEditRef = useRef(canEdit);
  const editRevisionRef = useRef(0);
  const editRoleRef = useRef(accessRole);
  useEffect(() => {
    canEditRef.current = canEdit;
    editRoleRef.current = accessRole;
    editRevisionRef.current += 1;
    return () => { canEditRef.current = false; };
  }, [accessRole, canEdit]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const { confirmation } = useDraftNavigation({ dirty: isDirty });
  const { isColumnVisible, visibleColumnCount, columnSettingsControl } = useSettingsTableColumns(
    "tips-settings-table:class-groups:v3",
    CLASS_GROUP_TABLE_COLUMNS,
  );

  const loadGroups = useCallback(async () => {
    const request = ++loadRequestRef.current;
    loadingRef.current = true;
    if (!supabase) {
      setLoadError("수업그룹 목록을 불러올 수 없습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.");
      loadingRef.current = false;
      setLoading(false);
      return false;
    }
    const client = supabase;

    setLoading(true);

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

      if (request !== loadRequestRef.current) return false;
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

        if (request !== loadRequestRef.current) return false;
        if (fallbackError) {
          throw fallbackError;
        }

        setLoadError(null);

        setRows(sortClassGroupRows(fallbackData || [], false).map((row, index) => toClassGroupRecord(row, index + 1)));
        setDeletedIds([]);
        setIsDirty(false);
        return true;
      }

      setLoadError(null);

      setRows(sortClassGroupRows(data || [], true).map((row, index) => toClassGroupRecord(row, index + 1)));
      setDeletedIds([]);
      setIsDirty(false);
      return true;
    } catch {
      if (request === loadRequestRef.current) setLoadError("수업그룹 목록을 불러오지 못했습니다. 다시 시도해 주세요.");
      return false;
    } finally {
      if (request === loadRequestRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadGroups();
    return () => { loadRequestRef.current += 1; };
  }, [loadGroups]);

  const retryLoad = async () => {
    if (savingRef.current || loadingRef.current || isDirty) return;
    retryFocusPendingRef.current = true;
    await loadGroups();
  };

  useEffect(() => {
    if (busy || !retryFocusPendingRef.current) return;
    retryFocusPendingRef.current = false;
    const target = loadError ? retryButtonRef.current : feedbackFocusRef.current;
    target?.focus({ preventScroll: true });
  }, [busy, loadError]);

  const nextSortOrder = useMemo(() => {
    const numericSortOrders = rows
      .map((row) => Number.parseInt(row.sortOrder, 10))
      .filter((value) => Number.isFinite(value));
    return (numericSortOrders.length > 0 ? Math.max(...numericSortOrders) : 0) + 1;
  }, [rows]);

  const handleFieldChange = (id: string, field: keyof ClassGroupRecord, value: string) => {
    if (!canEditRef.current || editRoleRef.current !== accessRole || savingRef.current || loadingRef.current) return;
    setRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setIsDirty(true);
  };

  const handleAdd = () => {
    if (!canEditRef.current || editRoleRef.current !== accessRole || savingRef.current || loadingRef.current) return;
    setRows((current) => [createEmptyClassGroup(nextSortOrder), ...current]);
    setIsDirty(true);
  };

  const handleSaveAll = async () => {
    if (!canEditRef.current || editRoleRef.current !== accessRole || savingRef.current || loadingRef.current) return;
    const nextRows = rows.map((row, index) => ({
      ...row,
      name: row.name.trim(),
      sortOrder: String(index + 1),
    }));
    if (nextRows.some((row) => !row.name)) {
      setError("그룹명을 입력하지 않은 행이 있습니다.");
      return;
    }

    savingRef.current = true;
    const saveRequest = loadRequestRef.current;
    const saveAccess = editRevisionRef.current;
    const canContinueSave = () => {
      const allowed = canEditRef.current
        && saveAccess === editRevisionRef.current
        && saveRequest === loadRequestRef.current;
      if (!allowed && canEditRef.current) {
        setError("권한이 변경되어 저장을 중단했습니다. 남은 변경 사항을 확인한 뒤 다시 저장해 주세요.");
      }
      return allowed;
    };
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      if (deletedIds.length > 0) {
        await managementService.deleteClassGroup(deletedIds);
        setDeletedIds((current) => current.filter((id) => !deletedIds.includes(id)));
        if (!canContinueSave()) return;
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

      if (!canContinueSave()) return;
      // The write has committed; a failed read must not turn it into a new draft.
      setRows(nextRows.map((row) => ({ ...row, isNew: false })));
      setDeletedIds([]);
      setIsDirty(false);
      if (await loadGroups()) {
        setMessage("수업그룹 변경 사항을 저장했습니다.");
      } else {
        setLoadError("변경 사항은 저장했지만 목록을 다시 불러오지 못했습니다. 다시 불러오기를 눌러 확인해 주세요.");
      }
    } catch {
      if (!canContinueSave()) return;
      setError("수업그룹을 저장하지 못했습니다. 입력한 내용은 유지됩니다. 다시 시도해 주세요.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = (row: ClassGroupRecord) => {
    if (!canEditRef.current || editRoleRef.current !== accessRole || savingRef.current || loadingRef.current) return;
    if (!row.isNew) {
      setDeletedIds((current) => (current.includes(row.id) ? current : [...current, row.id]));
    }
    setRows((current) => current.filter((item) => item.id !== row.id).map((item, index) => ({ ...item, sortOrder: String(index + 1) })));
    setIsDirty(true);
  };

  return (
    <SettingsWorkspaceShell>
      {confirmation}
      <SettingsMasterHeader
        actions={
          <>
            <Button type="button" size="sm" className="h-9" onClick={handleAdd} disabled={editBlocked} ref={feedbackFocusRef}>
              <Plus className="mr-2 size-4" />
              그룹 추가
            </Button>
            <Button type="button" size="sm" className="h-9" onClick={() => void handleSaveAll()} disabled={!canEdit || !isDirty || saving || loading}>
              {saving ? "저장 중" : "변경 저장"}
            </Button>
            {columnSettingsControl}
          </>
        }
      />

      {!canEdit ? (
        <p role="status" className="text-sm text-muted-foreground">읽기 전용 · 수업그룹은 운영자와 관리자만 수정할 수 있습니다.</p>
      ) : null}

      {loadError ? (
        <Alert variant="destructive">
          <AlertDescription className="flex min-w-0 flex-wrap items-center justify-between gap-2 break-words">
            <span>{loadError}</span>
            <Button ref={retryButtonRef} type="button" variant="outline" size="sm" disabled={busy || isDirty} onClick={() => void retryLoad()}>
              다시 불러오기
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {error || message ? (
        <ActionFeedback returnFocusRef={feedbackFocusRef} message={error || message || ""} error={Boolean(error)} onDismiss={() => { setError(null); setMessage(null); }} />
      ) : null}

      <div data-testid="class-group-settings-mobile-list" className="grid gap-2 md:hidden">
        {loading && rows.length === 0 ? (
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
                      disabled={editBlocked}
                      className="h-9"
                      value={row.name}
                      onChange={(event) => handleFieldChange(row.id, "name", event.target.value)}
                      placeholder="예: 중2 수학 진도 그룹"
                    />
                  </div>
                  <Button type="button" variant="destructive-ghost" size="icon" className="size-8 shrink-0" onClick={() => handleDelete(row)} disabled={editBlocked} aria-label="수업그룹 삭제">
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <Input
                  name="class-group-subject"
                  disabled={editBlocked}
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
            {loading && rows.length === 0 ? (
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
                        disabled={editBlocked}
                        className="h-9"
                        value={row.name}
                        onChange={(event) => handleFieldChange(row.id, "name", event.target.value)}
                        placeholder="예: 중2 수학 진도 그룹"
                      />
                    </TableCell> : null}
                    {isColumnVisible("subject") ? <TableCell className={settingsTableCellClass}>
                      <Input
                        name="class-group-subject"
                        disabled={editBlocked}
                        className="h-9"
                        value={row.subject}
                        onChange={(event) => handleFieldChange(row.id, "subject", event.target.value)}
                        placeholder="과목 (선택)"
                      />
                    </TableCell> : null}
                    {isColumnVisible("action") ? <TableCell className={settingsTableActionCellClass}>
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="destructive-ghost" size="icon" className="size-8" onClick={() => handleDelete(row)} disabled={editBlocked} aria-label="수업그룹 삭제">
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
