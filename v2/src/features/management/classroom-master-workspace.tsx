"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { createId, managementService } from "./management-service.js";
import {
  SettingsMasterHeader,
  SettingsTableFrame,
  settingsTableCellClass,
  settingsTableHeadClass,
} from "./settings-master-layout";
import { useSettingsTableColumns, type SettingsTableColumn } from "./settings-table-columns";
import { supabase } from "@/lib/supabase";

type ClassroomRecord = {
  id: string;
  name: string;
  subjects: string;
  isVisible: boolean;
  sortOrder: string;
  isNew?: boolean;
};

const SUBJECT_OPTIONS = ["영어", "수학"] as const;
const SUBJECT_FILTERS = ["전체", ...SUBJECT_OPTIONS] as const;
const CLASSROOM_TABLE_COLUMNS = [
  { id: "subjects", label: "과목" },
  { id: "name", label: "이름" },
  { id: "visible", label: "표시" },
  { id: "action", label: "작업", required: true },
] satisfies SettingsTableColumn[];

function normalizeSubjectValue(subjects: string) {
  const parsedSubjects = subjects
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return SUBJECT_OPTIONS.find((subject) => parsedSubjects.includes(subject)) ?? SUBJECT_OPTIONS[0];
}

function toClassroomRecord(row: Record<string, unknown>, index: number): ClassroomRecord {
  const subjects = Array.isArray(row.subjects)
    ? row.subjects.filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(", ")
    : "";

  return {
    id: String(row.id || createId()),
    name: typeof row.name === "string" ? row.name : "",
    subjects,
    isVisible: row.is_visible !== false,
    sortOrder: String(row.sort_order ?? index),
  };
}

function createEmptyClassroom(nextSortOrder: number): ClassroomRecord {
  return {
    id: createId(),
    name: "",
    subjects: "영어",
    isVisible: true,
    sortOrder: String(nextSortOrder),
    isNew: true,
  };
}

function reorderWithSequentialSort(rows: ClassroomRecord[], fromIndex: number, toIndex: number) {
  const nextRows = [...rows];
  const [moved] = nextRows.splice(fromIndex, 1);
  nextRows.splice(toIndex, 0, moved);
  return nextRows.map((row, index) => ({ ...row, sortOrder: String(index + 1) }));
}

export function ClassroomMasterWorkspace() {
  const [rows, setRows] = useState<ClassroomRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState<(typeof SUBJECT_FILTERS)[number]>("전체");
  const { isColumnVisible, visibleColumnCount, columnSettingsControl } = useSettingsTableColumns(
    "tips-settings-table:classrooms:v1",
    CLASSROOM_TABLE_COLUMNS,
  );

  const loadClassrooms = useCallback(async () => {
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
        .from("classroom_catalogs")
        .select("id, name, subjects, is_visible, sort_order")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (queryError) {
        throw queryError;
      }

      setRows((data || []).map((row, index) => toClassroomRecord(row as Record<string, unknown>, index + 1)));
      setDeletedIds([]);
      setIsDirty(false);
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "강의실 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadClassrooms();
  }, [loadClassrooms]);

  const nextSortOrder = useMemo(() => {
    const numericSortOrders = rows
      .map((row) => Number.parseInt(row.sortOrder, 10))
      .filter((value) => Number.isFinite(value));
    return (numericSortOrders.length > 0 ? Math.max(...numericSortOrders) : 0) + 1;
  }, [rows]);

  const filteredRows = useMemo(
    () => rows.filter((row) => subjectFilter === "전체" || row.subjects.includes(subjectFilter)),
    [rows, subjectFilter],
  );

  const handleFieldChange = (id: string, field: keyof ClassroomRecord, value: string | boolean) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setIsDirty(true);
  };

  const handleSubjectsChange = (id: string, value: (typeof SUBJECT_OPTIONS)[number]) => {
    handleFieldChange(id, "subjects", value);
  };

  const handleAdd = () => {
    setRows((current) => [createEmptyClassroom(nextSortOrder), ...current]);
    setIsDirty(true);
  };

  const handleSaveAll = async () => {
    const nextRows = rows.map((row, index) => ({
      ...row,
      name: row.name.trim(),
      subjects: normalizeSubjectValue(row.subjects),
      sortOrder: String(index + 1),
    }));
    if (nextRows.some((row) => !row.name)) {
      setError("강의실 이름을 입력하지 않은 행이 있습니다.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (deletedIds.length > 0) {
        await managementService.deleteClassroomCatalogs(deletedIds);
      }
      if (nextRows.length > 0) {
        await managementService.upsertClassroomCatalogs(
          nextRows.map((row, index) => ({
            id: row.id,
            name: row.name,
            subjects: [normalizeSubjectValue(row.subjects)],
            isVisible: row.isVisible,
            sortOrder: index + 1,
          })),
        );
      }
      await loadClassrooms();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "강의실 정보를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (row: ClassroomRecord) => {
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
    setIsDirty(true);
  };

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
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
            <Button type="button" size="sm" className="h-9" onClick={handleAdd}>
              <Plus className="mr-2 size-4" />
              강의실 추가
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
          <caption className="sr-only">강의실 목록</caption>
          <TableHeader>
            <TableRow>
              {isColumnVisible("subjects") ? <TableHead className={`w-[22%] ${settingsTableHeadClass}`}>과목</TableHead> : null}
              {isColumnVisible("name") ? <TableHead className={`w-[26%] ${settingsTableHeadClass}`}>이름</TableHead> : null}
              {isColumnVisible("visible") ? <TableHead className={`w-[10%] text-center ${settingsTableHeadClass}`}>표시</TableHead> : null}
              {isColumnVisible("action") ? <TableHead className={`w-[42%] text-right ${settingsTableHeadClass}`}>작업</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
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
                      <Select value={normalizeSubjectValue(row.subjects)} onValueChange={(value) => handleSubjectsChange(row.id, value as (typeof SUBJECT_OPTIONS)[number])}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="과목" />
                        </SelectTrigger>
                        <SelectContent>
                          {SUBJECT_OPTIONS.map((subject) => (
                            <SelectItem key={subject} value={subject}>
                              {subject}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell> : null}
                    {isColumnVisible("name") ? <TableCell className={settingsTableCellClass}>
                      <Input
                        name="classroom-name"
                        className="h-9"
                        value={row.name}
                        onChange={(event) => handleFieldChange(row.id, "name", event.target.value)}
                        placeholder="강의실 이름"
                      />
                    </TableCell> : null}
                    {isColumnVisible("visible") ? <TableCell className={`${settingsTableCellClass} text-center`}>
                      <div className="flex justify-center">
                        <Checkbox
                          aria-label="강의실 표시 여부"
                          checked={row.isVisible}
                          onCheckedChange={(checked) => handleFieldChange(row.id, "isVisible", checked === true)}
                        />
                      </div>
                    </TableCell> : null}
                    {isColumnVisible("action") ? <TableCell className={settingsTableCellClass}>
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" size="icon" className="size-8" onClick={() => handleMoveRow(row.id, "up")} disabled={saving || currentIndex <= 0} aria-label="강의실 순서 위로 이동">
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button type="button" variant="outline" size="icon" className="size-8" onClick={() => handleMoveRow(row.id, "down")} disabled={saving || currentIndex === rows.length - 1} aria-label="강의실 순서 아래로 이동">
                          <ArrowDown className="size-4" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => handleDelete(row)} disabled={saving} aria-label="강의실 삭제">
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
