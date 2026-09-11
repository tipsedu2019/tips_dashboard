"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";

import { useDraftNavigation } from "@/hooks/use-draft-navigation";

import { ActionFeedback } from "@/components/ui/action-feedback";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/lib/supabase";
import { createId, managementService } from "./management-service.js";
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

type SchoolRecord = {
  id: string;
  name: string;
  category: string;
  color: string;
  sortOrder: string;
  isNew?: boolean;
};

type NameSortDirection = "none" | "asc" | "desc";

const CATEGORY_FILTERS = ["전체", "초등", "중등", "고등"] as const;
const SCHOOL_TABLE_COLUMNS = [
  { id: "category", label: "분류" },
  { id: "name", label: "학교명" },
  { id: "action", label: "작업", required: true },
] satisfies SettingsTableColumn[];
const SCHOOL_CATEGORY_LABELS: Record<string, (typeof CATEGORY_FILTERS)[number]> = {
  elementary: "초등",
  elem: "초등",
  primary: "초등",
  middle: "중등",
  mid: "중등",
  secondary: "중등",
  high: "고등",
  highschool: "고등",
};
const SCHOOL_CATEGORY_VALUES: Record<Exclude<(typeof CATEGORY_FILTERS)[number], "전체">, string> = {
  초등: "elementary",
  중등: "middle",
  고등: "high",
};

function normalizeSchoolCategory(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return "";
  }

  const normalizedKey = trimmedValue.toLowerCase().replace(/[^a-z]/g, "");
  return SCHOOL_CATEGORY_LABELS[normalizedKey] ?? trimmedValue;
}

function toSchoolCategoryValue(value: string) {
  const normalizedCategory = normalizeSchoolCategory(value);
  if (
    normalizedCategory === "초등" ||
    normalizedCategory === "중등" ||
    normalizedCategory === "고등"
  ) {
    return SCHOOL_CATEGORY_VALUES[normalizedCategory];
  }
  return value.trim();
}

function normalizeSchoolName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function toSchoolRecord(row: Record<string, unknown>, index: number): SchoolRecord {
  return {
    id: String(row.id || createId()),
    name: typeof row.name === "string" ? row.name : "",
    category: normalizeSchoolCategory(typeof row.category === "string" ? row.category : ""),
    color: typeof row.color === "string" ? row.color : "",
    sortOrder: String(row.sort_order ?? index),
  };
}

function createEmptySchool(nextSortOrder: number, filter: (typeof CATEGORY_FILTERS)[number]): SchoolRecord {
  return {
    id: createId(),
    name: "",
    category: filter === "전체" ? "초등" : filter,
    color: "",
    sortOrder: String(nextSortOrder),
    isNew: true,
  };
}

function reorderWithSequentialSort(rows: SchoolRecord[], fromIndex: number, toIndex: number) {
  const nextRows = [...rows];
  const [moved] = nextRows.splice(fromIndex, 1);
  nextRows.splice(toIndex, 0, moved);
  return nextRows.map((row, index) => ({ ...row, sortOrder: String(index + 1) }));
}

export function SchoolMasterWorkspace() {
  const [rows, setRows] = useState<SchoolRecord[]>([]);
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
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const { confirmation } = useDraftNavigation({ dirty: isDirty });
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<(typeof CATEGORY_FILTERS)[number]>("전체");
  const [nameSortDirection, setNameSortDirection] = useState<NameSortDirection>("none");
  const { isColumnVisible, visibleColumnCount, columnSettingsControl } = useSettingsTableColumns(
    "tips-settings-table:schools:v1",
    SCHOOL_TABLE_COLUMNS,
  );

  const loadSchools = useCallback(async () => {
    const request = ++loadRequestRef.current;
    loadingRef.current = true;
    if (!supabase) {
      setLoadError("학교 목록을 불러올 수 없습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.");
      loadingRef.current = false;
      setLoading(false);
      return false;
    }

    setLoading(true);

    try {
      const { data, error: queryError } = await supabase
        .from("academic_schools")
        .select("id, name, category, color, sort_order")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (request !== loadRequestRef.current) return false;
      if (queryError) {
        throw queryError;
      }

      setLoadError(null);

      setRows((data || []).map((row, index) => toSchoolRecord(row as Record<string, unknown>, index + 1)));
      setDeletedIds([]);
      setIsDirty(false);
      return true;
    } catch {
      if (request === loadRequestRef.current) setLoadError("학교 목록을 불러오지 못했습니다. 다시 시도해 주세요.");
      return false;
    } finally {
      if (request === loadRequestRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadSchools();
    return () => { loadRequestRef.current += 1; };
  }, [loadSchools]);

  const retryLoad = async () => {
    if (savingRef.current || loadingRef.current || isDirty) return;
    retryFocusPendingRef.current = true;
    await loadSchools();
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

  const categoryCounts = useMemo(() => {
    const counts = new Map<(typeof CATEGORY_FILTERS)[number], number>();
    for (const filter of CATEGORY_FILTERS) {
      counts.set(filter, 0);
    }
    for (const row of rows) {
      const category = normalizeSchoolCategory(row.category);
      if (category === "초등" || category === "중등" || category === "고등") {
        counts.set(category, (counts.get(category) || 0) + 1);
      }
    }
    return counts;
  }, [rows]);

  const duplicateNameSet = useMemo(() => {
    const nameCounts = new Map<string, number>();
    for (const row of rows) {
      const normalizedName = normalizeSchoolName(row.name);
      if (!normalizedName) {
        continue;
      }
      nameCounts.set(normalizedName, (nameCounts.get(normalizedName) || 0) + 1);
    }
    return new Set(
      [...nameCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([name]) => name),
    );
  }, [rows]);

  const invalidRows = useMemo(() => {
    const invalid = new Set<string>();
    for (const row of rows) {
      const normalizedName = normalizeSchoolName(row.name);
      if (!normalizedName || duplicateNameSet.has(normalizedName)) {
        invalid.add(row.id);
      }
    }
    return invalid;
  }, [duplicateNameSet, rows]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = normalizeSchoolName(query).toLowerCase();
    return rows.filter((row) => {
      const categoryMatches = categoryFilter === "전체" || row.category.trim() === categoryFilter;
      const queryMatches = !normalizedQuery || normalizeSchoolName(row.name).toLowerCase().includes(normalizedQuery);
      return categoryMatches && queryMatches;
    });
  }, [categoryFilter, query, rows]);

  const handleFieldChange = (id: string, field: keyof SchoolRecord, value: string) => {
    if (savingRef.current || loadingRef.current) return;
    setRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setIsDirty(true);
  };

  const handleCategoryChange = (id: string, value: Exclude<(typeof CATEGORY_FILTERS)[number], "전체">) => {
    handleFieldChange(id, "category", value);
  };

  const handleAdd = () => {
    if (savingRef.current || loadingRef.current) return;
    setRows((current) => [createEmptySchool(nextSortOrder, categoryFilter), ...current]);
    setNameSortDirection("none");
    setIsDirty(true);
  };

  const handleResetChanges = () => {
    if (savingRef.current || loadingRef.current) return;
    setQuery("");
    setNameSortDirection("none");
    void loadSchools();
  };

  const handleSaveAll = async () => {
    if (savingRef.current || loadingRef.current) return;
    const nextRows = rows.map((row, index) => ({
      ...row,
      name: normalizeSchoolName(row.name),
      category: normalizeSchoolCategory(row.category),
      color: row.color.trim(),
      sortOrder: String(index + 1),
    }));

    if (invalidRows.size > 0) {
      setError("비어 있거나 중복된 학교명이 있습니다.");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      if (deletedIds.length > 0) {
        await managementService.deleteAcademicSchools(deletedIds);
      }
      if (nextRows.length > 0) {
        await managementService.upsertAcademicSchools(
          nextRows.map((row, index) => ({
            id: row.id,
            name: row.name,
            category: toSchoolCategoryValue(row.category),
            color: row.color || null,
            sortOrder: index + 1,
          })),
        );
      }
      // The write has committed; a failed read must not turn it into a new draft.
      setRows(nextRows.map((row) => ({ ...row, isNew: false })));
      setDeletedIds([]);
      setIsDirty(false);
      if (await loadSchools()) {
        setMessage("학교 변경 사항을 저장했습니다.");
      } else {
        setLoadError("변경 사항은 저장했지만 목록을 다시 불러오지 못했습니다. 다시 불러오기를 눌러 확인해 주세요.");
      }
    } catch {
      setError("학교 정보를 저장하지 못했습니다. 입력한 내용은 유지됩니다. 다시 시도해 주세요.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = (row: SchoolRecord) => {
    if (savingRef.current || loadingRef.current) return;
    if (!row.isNew) {
      setDeletedIds((current) => (current.includes(row.id) ? current : [...current, row.id]));
    }
    setRows((current) =>
      current.filter((item) => item.id !== row.id).map((item, index) => ({ ...item, sortOrder: String(index + 1) })),
    );
    setIsDirty(true);
  };

  const handleMoveRow = (id: string, direction: "up" | "down") => {
    if (savingRef.current || loadingRef.current) return;
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
    setNameSortDirection("none");
    setIsDirty(true);
  };

  const handleNameSort = () => {
    if (savingRef.current || loadingRef.current) return;
    const nextDirection: NameSortDirection = nameSortDirection === "asc" ? "desc" : "asc";
    const directionValue = nextDirection === "asc" ? 1 : -1;
    setRows((current) =>
      [...current]
        .sort((left, right) => left.name.localeCompare(right.name, "ko-KR", { numeric: true }) * directionValue)
        .map((row, index) => ({ ...row, sortOrder: String(index + 1) })),
    );
    setNameSortDirection(nextDirection);
    setIsDirty(true);
  };

  const dirtyLabel = isDirty
    ? "저장 전"
    : `${filteredRows.length}/${rows.length}개`;

  return (
    <SettingsWorkspaceShell>
      {confirmation}
      <SettingsMasterHeader
        filters={
          <>
            {CATEGORY_FILTERS.map((filter) => (
              <Button
                key={filter}
                type="button"
                variant={categoryFilter === filter ? "default" : "outline"}
                size="sm"
                className="h-8 gap-1.5 px-3 text-xs"
                onClick={() => setCategoryFilter(filter)}
              >
                <span>{filter}</span>
                <span className={categoryFilter === filter ? "text-primary-foreground/80" : "text-muted-foreground"}>
                  {filter === "전체" ? rows.length : categoryCounts.get(filter)}
                </span>
              </Button>
            ))}
          </>
        }
        actions={
          <>
            <div className="relative w-full min-w-[220px] sm:w-72" role="search" aria-label="학교명 검색">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                className="h-9 pr-9 pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="학교명 검색"
                aria-label="학교명 검색"
                autoComplete="off"
                enterKeyHint="search"
              />
              {query ? (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => setQuery("")}
                  aria-label="학교명 검색 초기화"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
            <div className="flex h-9 items-center rounded-md border border-border/70 px-3 text-xs font-medium text-muted-foreground">
              {dirtyLabel}
            </div>
            {deletedIds.length > 0 ? (
              <div className="flex h-9 items-center rounded-md border border-destructive/30 bg-destructive/5 px-3 text-xs font-medium text-destructive">
                삭제 대기 {deletedIds.length}
              </div>
            ) : null}
            {isDirty ? (
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={handleResetChanges} disabled={busy}>
                <RotateCcw className="mr-2 size-4" />
                되돌리기
              </Button>
            ) : null}
            <Button type="button" size="sm" className="h-9" onClick={handleAdd} disabled={busy} ref={feedbackFocusRef}>
              <Plus className="mr-2 size-4" />
              학교 추가
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9"
              onClick={() => void handleSaveAll()}
              disabled={!isDirty || saving || loading || invalidRows.size > 0}
            >
              {saving ? "저장 중" : "변경 저장"}
            </Button>
            {columnSettingsControl}
          </>
        }
      />

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

      <div data-testid="school-settings-mobile-list" className="grid gap-2 md:hidden">
        {loading && rows.length === 0 ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={`school-mobile-loading-${index}`} className="rounded-md border p-3">
              <Skeleton className="h-24 w-full" />
            </div>
          ))
        ) : filteredRows.length === 0 ? (
          <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            {query ? "검색 결과가 없습니다." : categoryFilter === "전체" ? "등록된 학교가 없습니다." : `${categoryFilter} 학교가 없습니다.`}
          </div>
        ) : (
          filteredRows.map((row) => {
            const currentIndex = rows.findIndex((item) => item.id === row.id);
            const normalizedName = normalizeSchoolName(row.name);
            const hasDuplicateName = normalizedName ? duplicateNameSet.has(normalizedName) : false;
            const isInvalid = invalidRows.has(row.id);

            return (
              <article
                key={row.id}
                data-testid={`school-settings-mobile-card-${row.id}`}
                className={row.isNew ? "rounded-md border border-primary/30 bg-primary/5 p-3" : "rounded-md border bg-background p-3"}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="rounded px-1.5 text-[11px]">
                        {normalizeSchoolCategory(row.category) || "분류 미정"}
                      </Badge>
                      {row.isNew ? <Badge className="rounded px-1.5 text-[11px]">신규</Badge> : null}
                      {hasDuplicateName ? (
                        <Badge variant="destructive" className="rounded px-1.5 text-[11px]">
                          중복
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-8"
                        onClick={() => handleMoveRow(row.id, "up")}
                        disabled={busy || currentIndex <= 0}
                        aria-label="학교 순서 위로 이동"
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-8"
                        onClick={() => handleMoveRow(row.id, "down")}
                        disabled={busy || currentIndex === rows.length - 1}
                        aria-label="학교 순서 아래로 이동"
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="destructive-ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => handleDelete(row)}
                        disabled={busy}
                        aria-label="학교 삭제"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Select
                      disabled={busy}
                      value={normalizeSchoolCategory(row.category)}
                      onValueChange={(value) =>
                        handleCategoryChange(row.id, value as Exclude<(typeof CATEGORY_FILTERS)[number], "전체">)
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="분류" />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORY_FILTERS.filter((filter) => filter !== "전체").map((filter) => (
                          <SelectItem key={filter} value={filter}>
                            {filter}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      name="school-name"
                      disabled={busy}
                      className={`h-9 ${isInvalid ? "border-destructive focus-visible:ring-destructive/30" : ""}`}
                      value={row.name}
                      onChange={(event) => handleFieldChange(row.id, "name", event.target.value)}
                      placeholder="학교명"
                      aria-label={`${row.name || "새 학교"} 학교명`}
                      aria-invalid={isInvalid}
                    />
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>

      <div className="hidden md:block">
      <SettingsTableFrame>
        <Table className="table-fixed min-w-[720px]">
          <caption className="sr-only">학교 마스터 목록</caption>
          <TableHeader>
            <TableRow>
              {isColumnVisible("category") ? (
                <TableHead className={`w-[160px] ${settingsTableHeadClass}`}>분류</TableHead>
              ) : null}
              {isColumnVisible("name") ? (
                <TableHead className={`w-auto ${settingsTableHeadClass}`}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-1 text-left font-semibold hover:text-foreground"
                    onClick={handleNameSort}
                    disabled={busy}
                    aria-label="학교명으로 정렬"
                  >
                    학교명
                    <span className="text-[11px] text-muted-foreground">
                      {nameSortDirection === "asc" ? "↑" : nameSortDirection === "desc" ? "↓" : "↕"}
                    </span>
                  </button>
                </TableHead>
              ) : null}
              {isColumnVisible("action") ? (
                <TableHead className={`w-[132px] ${settingsTableActionHeadClass}`}>작업</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 ? (
              Array.from({ length: 4 }).map((_, index) => (
                <TableRow key={`school-loading-${index}`}>
                  <TableCell colSpan={visibleColumnCount} className="px-3 py-2">
                    <Skeleton className="h-10 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  {query ? "검색 결과가 없습니다." : categoryFilter === "전체" ? "등록된 학교가 없습니다." : `${categoryFilter} 학교가 없습니다.`}
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row) => {
                const currentIndex = rows.findIndex((item) => item.id === row.id);
                const normalizedName = normalizeSchoolName(row.name);
                const hasDuplicateName = normalizedName ? duplicateNameSet.has(normalizedName) : false;
                const isInvalid = invalidRows.has(row.id);

                return (
                  <TableRow key={row.id} className={row.isNew ? "bg-primary/5" : undefined}>
                    {isColumnVisible("category") ? (
                      <TableCell className={settingsTableCellClass}>
                        <Select
                          disabled={busy}
                          value={normalizeSchoolCategory(row.category)}
                          onValueChange={(value) =>
                            handleCategoryChange(row.id, value as Exclude<(typeof CATEGORY_FILTERS)[number], "전체">)
                          }
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="분류" />
                          </SelectTrigger>
                          <SelectContent>
                            {CATEGORY_FILTERS.filter((filter) => filter !== "전체").map((filter) => (
                              <SelectItem key={filter} value={filter}>
                                {filter}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    ) : null}
                    {isColumnVisible("name") ? (
                      <TableCell className={settingsTableCellClass}>
                        <div className="flex items-center gap-2">
                          <Input
                            name="school-name"
                            disabled={busy}
                            className={`h-9 ${isInvalid ? "border-destructive focus-visible:ring-destructive/30" : ""}`}
                            value={row.name}
                            onChange={(event) => handleFieldChange(row.id, "name", event.target.value)}
                            placeholder="학교명"
                            aria-label={`${row.name || "새 학교"} 학교명`}
                            aria-invalid={isInvalid}
                          />
                          {row.isNew ? (
                            <span className="shrink-0 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
                              신규
                            </span>
                          ) : null}
                          {hasDuplicateName ? (
                            <span className="shrink-0 rounded-md bg-destructive/10 px-2 py-1 text-[11px] font-medium text-destructive">
                              중복
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                    ) : null}
                    {isColumnVisible("action") ? (
                      <TableCell className={settingsTableActionCellClass}>
                        <div className="flex justify-end gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="size-8"
                            onClick={() => handleMoveRow(row.id, "up")}
                            disabled={busy || currentIndex <= 0}
                            aria-label="학교 순서 위로 이동"
                          >
                            <ArrowUp className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="size-8"
                            onClick={() => handleMoveRow(row.id, "down")}
                            disabled={busy || currentIndex === rows.length - 1}
                            aria-label="학교 순서 아래로 이동"
                          >
                            <ArrowDown className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="destructive-ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => handleDelete(row)}
                            disabled={busy}
                            aria-label="학교 삭제"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
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
