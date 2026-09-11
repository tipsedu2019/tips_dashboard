"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { useDraftNavigation } from "@/hooks/use-draft-navigation";

import { ActionFeedback } from "@/components/ui/action-feedback";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ACADEMIC_SUBJECTS,
  ACADEMIC_SUBJECT_VALUES,
  parseAcademicSubject,
  sortAcademicSubjects,
  type AcademicSubjectValue,
} from "@/lib/academic-subject-registry";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";
import {
  createId,
  filterClassroomCatalogRowsForSubject,
  managementService,
} from "./management-service.js";
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

type ClassroomRecord = {
  id: string;
  name: string;
  subjects: AcademicSubjectValue[];
  campus: "본관" | "별관" | "";
  hasInvalidSubjectMembership?: boolean;
  isVisible: boolean;
  sortOrder: string;
  isNew?: boolean;
};

const SUBJECT_OPTIONS = ACADEMIC_SUBJECT_VALUES;
const SUBJECT_FILTERS = ["전체", ...SUBJECT_OPTIONS] as const;
const CAMPUS_OPTIONS = ["본관", "별관"] as const;
const CLASSROOM_TABLE_COLUMNS = [
  { id: "subjects", label: "과목" },
  { id: "name", label: "이름", required: true },
  { id: "visible", label: "표시" },
  { id: "action", label: "작업", required: true },
] satisfies SettingsTableColumn[];

function toClassroomRecord(row: Record<string, unknown>, index: number): ClassroomRecord {
  const sourceSubjects = Array.isArray(row.subjects)
    ? row.subjects.filter((value): value is string => typeof value === "string")
    : [];
  const hasInvalidSubjectMembership = sourceSubjects.length === 0
    || sourceSubjects.some((value) => parseAcademicSubject(value) === null);
  const subjects = sortAcademicSubjects(sourceSubjects);

  return {
    id: String(row.id || createId()),
    name: typeof row.name === "string" ? row.name : "",
    subjects,
    campus: row.campus === "본관" || row.campus === "별관" ? row.campus : "",
    hasInvalidSubjectMembership,
    isVisible: row.is_visible !== false,
    sortOrder: String(row.sort_order ?? index),
  };
}

function createEmptyClassroom(nextSortOrder: number): ClassroomRecord {
  return {
    id: createId(),
    name: "",
    subjects: ["영어"],
    campus: "",
    isVisible: true,
    sortOrder: String(nextSortOrder),
    isNew: true,
  };
}

function ClassroomCampusSelect({
  campus,
  disabled,
  onChange,
}: {
  campus: ClassroomRecord["campus"];
  disabled: boolean;
  onChange: (campus: Exclude<ClassroomRecord["campus"], "">) => void;
}) {
  return (
    <div className="grid w-28 shrink-0 gap-1">
      <Select
        value={campus}
        disabled={disabled}
        onValueChange={(value) => {
          if (value === "본관" || value === "별관") {
            onChange(value);
          }
        }}
      >
        <SelectTrigger className="h-9 w-full" aria-label="강의실 건물">
          <SelectValue placeholder="건물 선택" />
        </SelectTrigger>
        <SelectContent>
          {CAMPUS_OPTIONS.map((option) => (
            <SelectItem key={option} value={option}>{option}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!campus ? (
        <Badge variant="outline" className="w-fit rounded px-1.5 text-[11px] text-destructive">
          건물 미지정
        </Badge>
      ) : null}
    </div>
  );
}

function ClassroomSubjectToggles({
  subjects,
  disabled,
  onToggle,
}: {
  subjects: readonly AcademicSubjectValue[];
  disabled: boolean;
  onToggle: (subject: AcademicSubjectValue) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="강의실 과목 선택">
      {ACADEMIC_SUBJECTS.map((subject) => {
        const selected = subjects.includes(subject.value);
        return (
          <Button
            key={subject.key}
            type="button"
            size="sm"
            variant={selected ? "default" : "outline"}
            className="h-8 px-3 text-xs"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onToggle(subject.value)}
          >
            {subject.value}
          </Button>
        );
      })}
    </div>
  );
}

function reorderWithSequentialSort(rows: ClassroomRecord[], fromIndex: number, toIndex: number) {
  const nextRows = [...rows];
  const [moved] = nextRows.splice(fromIndex, 1);
  nextRows.splice(toIndex, 0, moved);
  return nextRows.map((row, index) => ({ ...row, sortOrder: String(index + 1) }));
}

export function ClassroomMasterWorkspace() {
  const { user, canManageAll, isTeacher } = useAuth();
  return <ClassroomMasterEditor key={user?.id ?? "anonymous"} accessRole={user?.role ?? "viewer"} canEdit={Boolean(canManageAll || isTeacher)} />;
}

function ClassroomMasterEditor({ canEdit, accessRole }: { canEdit: boolean; accessRole: string }) {
  const [rows, setRows] = useState<ClassroomRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const hasLoadedRef = useRef(false);
  const loadAbortRef = useRef<AbortController | null>(null);
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
  const editBlocked = busy || !hasLoaded || !canEdit;
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
  const [subjectFilter, setSubjectFilter] = useState<(typeof SUBJECT_FILTERS)[number]>("전체");
  const { isColumnVisible, visibleColumnCount, columnSettingsControl } = useSettingsTableColumns(
    "tips-settings-table:classrooms:v1",
    CLASSROOM_TABLE_COLUMNS,
  );

  const loadClassrooms = useCallback(async () => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const request = ++loadRequestRef.current;
    loadingRef.current = true;
    if (!supabase) {
      setLoadError("강의실 목록을 불러올 수 없습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.");
      loadingRef.current = false;
      setLoading(false);
      return false;
    }

    setLoading(true);

    try {
      // This editor saves and reorders the whole catalog. Publish no partial page.
      const data: Record<string, unknown>[] = [];
      const seenIds = new Set<string>();
      for (let offset = 0; ; offset += 30) {
        const { data: page, error: queryError } = await supabase
          .from("classroom_catalogs")
          .select("id, name, subjects, campus, is_visible, sort_order")
          .range(offset, offset + 29)
          .limit(30)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true })
          .order("id", { ascending: true })
          .abortSignal(AbortSignal.any([AbortSignal.timeout(8_000), controller.signal]))
          .retry(false);

        if (request !== loadRequestRef.current || controller.signal.aborted) return false;
        if (queryError) throw queryError;
        if (!Array.isArray(page) || page.length > 30) throw new Error("settings_page_invalid");
        for (const row of page) {
          const id = String(row.id ?? "");
          if (!id || seenIds.has(id)) throw new Error("settings_page_changed");
          seenIds.add(id);
          data.push(row as Record<string, unknown>);
        }
        if (page.length < 30) break;
      }
      hasLoadedRef.current = true;
      setHasLoaded(true);

      setLoadError(null);

      setRows((data || []).map((row, index) => toClassroomRecord(row as Record<string, unknown>, index + 1)));
      setDeletedIds([]);
      setIsDirty(false);
      return true;
    } catch {
      if (request === loadRequestRef.current) setLoadError("강의실 목록을 불러오지 못했습니다. 다시 시도해 주세요.");
      return false;
    } finally {
      if (request === loadRequestRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadClassrooms();
    return () => { loadRequestRef.current += 1; loadAbortRef.current?.abort(); };
  }, [loadClassrooms]);

  const retryLoad = async () => {
    if (savingRef.current || loadingRef.current || isDirty) return;
    retryFocusPendingRef.current = true;
    await loadClassrooms();
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

  const filteredRows = useMemo(
    () => filterClassroomCatalogRowsForSubject(rows, subjectFilter) as ClassroomRecord[],
    [rows, subjectFilter],
  );

  const handleFieldChange = (id: string, field: keyof ClassroomRecord, value: string | boolean) => {
    if (!hasLoadedRef.current || !canEditRef.current || editRoleRef.current !== accessRole || savingRef.current || loadingRef.current) return;
    setRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setIsDirty(true);
  };

  const handleSubjectToggle = (id: string, subject: AcademicSubjectValue) => {
    if (!hasLoadedRef.current || !canEditRef.current || editRoleRef.current !== accessRole || savingRef.current || loadingRef.current) return;
    const row = rows.find((item) => item.id === id);
    if (!row) return;

    const nextSubjects = row.subjects.includes(subject)
      ? row.subjects.filter((value) => value !== subject)
      : sortAcademicSubjects([...row.subjects, subject]);
    if (nextSubjects.length === 0) {
      setError("강의실 과목을 하나 이상 선택해 주세요.");
      return;
    }

    setRows((current) => current.map((item) => (
      item.id === id
        ? {
            ...item,
            subjects: nextSubjects,
            hasInvalidSubjectMembership: false,
          }
        : item
    )));
    setError(null);
    setIsDirty(true);
  };

  const handleAdd = () => {
    if (!hasLoadedRef.current || !canEditRef.current || editRoleRef.current !== accessRole || savingRef.current || loadingRef.current) return;
    setRows((current) => [createEmptyClassroom(nextSortOrder), ...current]);
    setIsDirty(true);
  };

  const handleSaveAll = async () => {
    if (!hasLoadedRef.current || !canEditRef.current || editRoleRef.current !== accessRole || savingRef.current || loadingRef.current) return;
    const nextRows = rows.map((row, index) => ({
      ...row,
      name: row.name.trim(),
      subjects: sortAcademicSubjects(row.subjects),
      sortOrder: String(index + 1),
    }));
    if (nextRows.some((row) => !row.name)) {
      setError("강의실 이름을 입력하지 않은 행이 있습니다.");
      return;
    }
    if (nextRows.some((row) => (
      row.hasInvalidSubjectMembership || row.subjects.length === 0
    ))) {
      setError("강의실 과목을 하나 이상 선택해 주세요.");
      return;
    }
    if (nextRows.some((row) => !row.campus)) {
      setError("강의실 건물을 선택해 주세요.");
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
        await managementService.deleteClassroomCatalogs(deletedIds);
        setDeletedIds((current) => current.filter((id) => !deletedIds.includes(id)));
        if (!canContinueSave()) return;
      }
      if (nextRows.length > 0) {
        await managementService.upsertClassroomCatalogs(
          nextRows.map((row, index) => ({
            id: row.id,
            name: row.name,
            subjects: [...row.subjects],
            campus: row.campus,
            isVisible: row.isVisible,
            sortOrder: index + 1,
          })),
        );
      }
      if (!canContinueSave()) return;
      // The write has committed; a failed read must not turn it into a new draft.
      setRows(nextRows.map((row) => ({ ...row, isNew: false })));
      setDeletedIds([]);
      setIsDirty(false);
      if (await loadClassrooms()) {
        setMessage("강의실 변경 사항을 저장했습니다.");
      } else {
        setLoadError("변경 사항은 저장했지만 목록을 다시 불러오지 못했습니다. 다시 불러오기를 눌러 확인해 주세요.");
      }
    } catch {
      if (!canContinueSave()) return;
      setError("강의실 정보를 저장하지 못했습니다. 입력한 내용은 유지됩니다. 다시 시도해 주세요.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = (row: ClassroomRecord) => {
    if (!hasLoadedRef.current || !canEditRef.current || editRoleRef.current !== accessRole || savingRef.current || loadingRef.current) return;
    if (!row.isNew) {
      setDeletedIds((current) => (current.includes(row.id) ? current : [...current, row.id]));
    }
    setRows((current) => current.filter((item) => item.id !== row.id).map((item, index) => ({ ...item, sortOrder: String(index + 1) })));
    setIsDirty(true);
  };

  const handleMoveRow = (id: string, direction: "up" | "down") => {
    if (!hasLoadedRef.current || !canEditRef.current || editRoleRef.current !== accessRole || savingRef.current || loadingRef.current) return;
    const currentIndex = rows.findIndex((row) => row.id === id);
    if (currentIndex < 0) {
      return;
    }

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= rows.length) {
      return;
    }

    const reorderedRows = reorderWithSequentialSort(rows, currentIndex, targetIndex);
    setRows(reorderedRows);
    setIsDirty(true);
  };

  return (
    <SettingsWorkspaceShell>
      {confirmation}
      <SettingsMasterHeader
        filters={SUBJECT_FILTERS.map((filter) => (
          <Button
            key={filter}
            type="button"
            variant={subjectFilter === filter ? "default" : "outline"}
            size="sm"
            className="h-8 px-3 text-xs"
            onClick={() => setSubjectFilter(filter)}
          >
            {filter}
          </Button>
        ))}
        actions={
          <>
            <Button type="button" size="sm" className="h-9" onClick={handleAdd} disabled={editBlocked} ref={feedbackFocusRef}>
              <Plus className="mr-2 size-4" />
              강의실 추가
            </Button>
            <Button type="button" size="sm" className="h-9" onClick={() => void handleSaveAll()} disabled={!hasLoaded || !canEdit || !isDirty || saving || loading}>
              {saving ? "저장 중" : "변경 저장"}
            </Button>
            {columnSettingsControl}
          </>
        }
      />

      {!canEdit ? (
        <p role="status" className="text-sm text-muted-foreground">읽기 전용 · 강의실을 수정할 권한이 없습니다.</p>
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

      <div data-testid="classroom-settings-mobile-list" className="grid gap-2 md:hidden">
        {loading && rows.length === 0 ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={`classroom-mobile-loading-${index}`} className="rounded-md border p-3">
              <Skeleton className="h-24 w-full" />
            </div>
          ))
        ) : filteredRows.length === 0 ? (
          <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            {subjectFilter === "전체" ? "등록된 강의실이 없습니다." : `${subjectFilter} 과목 강의실이 없습니다.`}
          </div>
        ) : (
          filteredRows.map((row) => {
            const currentIndex = rows.findIndex((item) => item.id === row.id);

            return (
              <article
                key={row.id}
                data-testid={`classroom-settings-mobile-card-${row.id}`}
                className={row.isNew ? "rounded-md border border-primary/30 bg-primary/5 p-3" : "rounded-md border bg-background p-3"}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="rounded px-1.5 text-[11px]">
                        {row.subjects.join(", ") || "과목 미선택"}
                      </Badge>
                      {row.isVisible ? (
                        <Badge variant="outline" className="rounded px-1.5 text-[11px]">
                          표시
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="rounded px-1.5 text-[11px] text-muted-foreground">
                          숨김
                        </Badge>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button type="button" variant="outline" size="icon" className="size-8" onClick={() => handleMoveRow(row.id, "up")} disabled={editBlocked || currentIndex <= 0} aria-label="강의실 순서 위로 이동">
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button type="button" variant="outline" size="icon" className="size-8" onClick={() => handleMoveRow(row.id, "down")} disabled={editBlocked || currentIndex === rows.length - 1} aria-label="강의실 순서 아래로 이동">
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button type="button" variant="destructive-ghost" size="icon" className="size-8" onClick={() => handleDelete(row)} disabled={editBlocked} aria-label="강의실 삭제">
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <ClassroomSubjectToggles
                      subjects={row.subjects}
                      disabled={editBlocked}
                      onToggle={(subject) => handleSubjectToggle(row.id, subject)}
                    />
                    <div className="grid grid-cols-[minmax(0,1fr)_7rem] items-start gap-2">
                      <Input
                        name="classroom-name"
                        disabled={editBlocked}
                        className="h-9"
                        value={row.name}
                        onChange={(event) => handleFieldChange(row.id, "name", event.target.value)}
                        placeholder="강의실 이름"
                        aria-label={`${row.name || "새 강의실"} 강의실 이름`}
                      />
                      <ClassroomCampusSelect
                        campus={row.campus}
                        disabled={editBlocked}
                        onChange={(campus) => handleFieldChange(row.id, "campus", campus)}
                      />
                    </div>
                    <label className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <span>표시</span>
                      <Checkbox
                        aria-label="강의실 표시 여부"
                        disabled={editBlocked}
                        checked={row.isVisible}
                        onCheckedChange={(checked) => handleFieldChange(row.id, "isVisible", checked === true)}
                      />
                    </label>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>

      <div className="hidden md:block">
      <SettingsTableFrame>
        <Table className="table-fixed">
          <caption className="sr-only">강의실 목록</caption>
          <TableHeader>
            <TableRow>
              {isColumnVisible("subjects") ? <TableHead className={`w-[22%] ${settingsTableHeadClass}`}>과목</TableHead> : null}
              {isColumnVisible("name") ? <TableHead className={`w-[26%] ${settingsTableHeadClass}`}>이름</TableHead> : null}
              {isColumnVisible("visible") ? <TableHead className={`w-[10%] text-center ${settingsTableHeadClass}`}>표시</TableHead> : null}
              {isColumnVisible("action") ? <TableHead className={`w-[42%] ${settingsTableActionHeadClass}`}>작업</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 ? (
              Array.from({ length: 4 }).map((_, index) => (
                <TableRow key={`classroom-loading-${index}`}>
                  <TableCell colSpan={visibleColumnCount} className="px-3 py-2">
                    <Skeleton className="h-10 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  {subjectFilter === "전체" ? "등록된 강의실이 없습니다." : `${subjectFilter} 과목 강의실이 없습니다.`}
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row) => {
                const currentIndex = rows.findIndex((item) => item.id === row.id);

                return (
                  <TableRow key={row.id}>
                    {isColumnVisible("subjects") ? <TableCell className={settingsTableCellClass}>
                      <ClassroomSubjectToggles
                        subjects={row.subjects}
                        disabled={editBlocked}
                        onToggle={(subject) => handleSubjectToggle(row.id, subject)}
                      />
                    </TableCell> : null}
                    {isColumnVisible("name") ? <TableCell className={settingsTableCellClass}>
                      <div className="grid grid-cols-[minmax(0,1fr)_7rem] items-start gap-2">
                        <Input
                          name="classroom-name"
                          disabled={editBlocked}
                          className="h-9"
                          value={row.name}
                          onChange={(event) => handleFieldChange(row.id, "name", event.target.value)}
                          placeholder="강의실 이름"
                          aria-label={`${row.name || "새 강의실"} 강의실 이름`}
                        />
                        <ClassroomCampusSelect
                          campus={row.campus}
                          disabled={editBlocked}
                          onChange={(campus) => handleFieldChange(row.id, "campus", campus)}
                        />
                      </div>
                    </TableCell> : null}
                    {isColumnVisible("visible") ? <TableCell className={`${settingsTableCellClass} text-center`}>
                      <div className="flex justify-center">
                        <Checkbox
                          aria-label="강의실 표시 여부"
                          disabled={editBlocked}
                          checked={row.isVisible}
                          onCheckedChange={(checked) => handleFieldChange(row.id, "isVisible", checked === true)}
                        />
                      </div>
                    </TableCell> : null}
                    {isColumnVisible("action") ? <TableCell className={settingsTableActionCellClass}>
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" size="icon" className="size-8" onClick={() => handleMoveRow(row.id, "up")} disabled={editBlocked || currentIndex <= 0} aria-label="강의실 순서 위로 이동">
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button type="button" variant="outline" size="icon" className="size-8" onClick={() => handleMoveRow(row.id, "down")} disabled={editBlocked || currentIndex === rows.length - 1} aria-label="강의실 순서 아래로 이동">
                          <ArrowDown className="size-4" />
                        </Button>
                        <Button type="button" variant="destructive-ghost" size="icon" className="size-8" onClick={() => handleDelete(row)} disabled={editBlocked} aria-label="강의실 삭제">
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
