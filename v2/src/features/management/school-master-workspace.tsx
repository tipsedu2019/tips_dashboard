"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { createId, managementService } from "./management-service.js";
import {
  SettingsMasterHeader,
  SettingsTableFrame,
  settingsTableCellClass,
  settingsTableHeadClass,
} from "./settings-master-layout";
import { useSettingsTableColumns, type SettingsTableColumn } from "./settings-table-columns";
import { supabase } from "@/lib/supabase";

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

function toSchoolRecord(row: Record<string, unknown>, index: number): SchoolRecord {
  return {
    id: String(row.id || createId()),
    name: typeof row.name === "string" ? row.name : "",
    category: normalizeSchoolCategory(typeof row.category === "string" ? row.category : ""),
    color: typeof row.color === "string" ? row.color : "",
    sortOrder: String(row.sort_order ?? index),
  };
}

function createEmptySchool(nextSortOrder: number): SchoolRecord {
  return {
    id: createId(),
    name: "",
    category: "초등",
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

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error && typeof error === "object") {
    const maybeError = error as { message?: unknown; details?: unknown; hint?: unknown };
    const parts = [maybeError.message, maybeError.details, maybeError.hint]
      .map((part) => (typeof part === "string" ? part.trim() : ""))
      .filter(Boolean);
    if (parts.length > 0) {
      return parts.join(" ");
    }
  }
  return fallback;
}

export function SchoolMasterWorkspace() {
  const [rows, setRows] = useState<SchoolRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<(typeof CATEGORY_FILTERS)[number]>("전체");
  const [nameSortDirection, setNameSortDirection] = useState<NameSortDirection>("none");
  const { isColumnVisible, visibleColumnCount, columnSettingsControl } = useSettingsTableColumns(
    "tips-settings-table:schools:v1",
    SCHOOL_TABLE_COLUMNS,
  );

  const loadSchools = useCallback(async () => {
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
        .from("academic_schools")
        .select("id, name, category, color, sort_order")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (queryError) {
        throw queryError;
      }

      setRows((data || []).map((row, index) => toSchoolRecord(row as Record<string, unknown>, index + 1)));
      setDeletedIds([]);
      setIsDirty(false);
    } catch (loadError) {
      setRows([]);
      setError(getErrorMessage(loadError, "학교 목록을 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSchools();
  }, [loadSchools]);

  const nextSortOrder = useMemo(() => {
    const numericSortOrders = rows
      .map((row) => Number.parseInt(row.sortOrder, 10))
      .filter((value) => Number.isFinite(value));
    return (numericSortOrders.length > 0 ? Math.max(...numericSortOrders) : 0) + 1;
  }, [rows]);

  const filteredRows = useMemo(
    () => rows.filter((row) => categoryFilter === "전체" || row.category.trim() === categoryFilter),
    [rows, categoryFilter],
  );

  const handleFieldChange = (id: string, field: keyof SchoolRecord, value: string) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setIsDirty(true);
  };

  const handleCategoryChange = (id: string, value: Exclude<(typeof CATEGORY_FILTERS)[number], "전체">) => {
    handleFieldChange(id, "category", value);
  };

  const handleAdd = () => {
    setRows((current) => [createEmptySchool(nextSortOrder), ...current]);
    setNameSortDirection("none");
    setIsDirty(true);
  };

  const handleSaveAll = async () => {
    const nextRows = rows.map((row, index) => ({
      ...row,
      name: row.name.trim(),
      category: normalizeSchoolCategory(row.category),
      color: row.color.trim(),
      sortOrder: String(index + 1),
    }));
    const invalidRow = nextRows.find((row) => !row.name);
    if (invalidRow) {
      setError("학교명을 입력하지 않은 행이 있습니다.");
      return;
    }

    setSaving(true);
    setError(null);

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
      await loadSchools();
    } catch (saveError) {
      setError(getErrorMessage(saveError, "학교 정보를 저장하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (row: SchoolRecord) => {
    if (!row.isNew) {
      setDeletedIds((current) => (current.includes(row.id) ? current : [...current, row.id]));
    }
    setRows((current) => current.filter((item) => item.id !== row.id).map((item, index) => ({ ...item, sortOrder: String(index + 1) })));
    setIsDirty(true);
  };

  const handleMoveRow = (id: string, direction: "up" | "down") => {
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

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
      <SettingsMasterHeader
        filters={CATEGORY_FILTERS.map((filter) => (
          <Button
            key={filter}
            type="button"
            variant={categoryFilter === filter ? "default" : "outline"}
            size="sm"
            className="h-8 px-3 text-xs"
            onClick={() => setCategoryFilter(filter)}
          >
            {filter}
          </Button>
        ))}
        actions={
          <>
            <Button type="button" size="sm" className="h-9" onClick={handleAdd}>
            <Plus className="mr-2 size-4" />
            학교 추가
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
          <caption className="sr-only">학교 마스터 목록</caption>
          <TableHeader>
            <TableRow>
              {isColumnVisible("category") ? <TableHead className={`w-[18%] ${settingsTableHeadClass}`}>분류</TableHead> : null}
              {isColumnVisible("name") ? <TableHead className={`w-[52%] ${settingsTableHeadClass}`}>
                <button
                  type="button"
                  className="flex w-full items-center gap-1 text-left font-semibold hover:text-foreground"
                  onClick={handleNameSort}
                  aria-label="학교명으로 정렬"
                >
                  학교명
                  <span className="text-[11px] text-muted-foreground">
                    {nameSortDirection === "asc" ? "↑" : nameSortDirection === "desc" ? "↓" : "↕"}
                  </span>
                </button>
              </TableHead> : null}
              {isColumnVisible("action") ? <TableHead className={`w-[30%] text-right ${settingsTableHeadClass}`}>작업</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
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
                  {categoryFilter === "전체" ? "등록된 학교가 없습니다." : `${categoryFilter} 분류 학교가 없습니다.`}
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row) => {
                const currentIndex = rows.findIndex((item) => item.id === row.id);

                return (
                  <TableRow key={row.id}>
                    {isColumnVisible("category") ? <TableCell className={settingsTableCellClass}>
                      <Select value={normalizeSchoolCategory(row.category)} onValueChange={(value) => handleCategoryChange(row.id, value as Exclude<(typeof CATEGORY_FILTERS)[number], "전체">)}>
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
                    </TableCell> : null}
                    {isColumnVisible("name") ? <TableCell className={settingsTableCellClass}>
                      <Input
                        name="school-name"
                        className="h-9"
                        value={row.name}
                        onChange={(event) => handleFieldChange(row.id, "name", event.target.value)}
                        placeholder="학교명"
                      />
                    </TableCell> : null}
                    {isColumnVisible("action") ? <TableCell className={settingsTableCellClass}>
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" size="icon" className="size-8" onClick={() => handleMoveRow(row.id, "up")} disabled={saving || currentIndex <= 0} aria-label="학교 순서 위로 이동">
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button type="button" variant="outline" size="icon" className="size-8" onClick={() => handleMoveRow(row.id, "down")} disabled={saving || currentIndex === rows.length - 1} aria-label="학교 순서 아래로 이동">
                          <ArrowDown className="size-4" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => handleDelete(row)} disabled={saving} aria-label="학교 삭제">
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
