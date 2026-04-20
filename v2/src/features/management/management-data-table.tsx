"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnOrderState,
  type ExpandedState,
  type GroupingState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getGroupedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Search,
  Settings2,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ManagementKind, ManagementRow, ManagementStat } from "@/features/management/use-management-records";

const STORAGE_VERSION = 2;

const RAW_COLUMN_LABELS: Record<string, string> = {
  id: "ID",
  uid: "학생 UID",
  name: "이름",
  school: "학교",
  grade: "학년",
  contact: "연락처",
  parent_contact: "학부모 연락처",
  enroll_date: "등록일",
  class_ids: "수강 반 ID",
  waitlist_class_ids: "대기 반 ID",
  subject: "과목",
  teacher: "담당 교사",
  teacher_name: "담당 교사",
  schedule: "시간표",
  room: "강의실",
  classroom: "강의실",
  capacity: "정원",
  status: "상태",
  textbook_ids: "교재 ID",
  fee: "수강료",
  tuition: "수강료",
  publisher: "출판사",
  title: "교재명",
  price: "가격",
  tags: "태그",
  lessons: "단원",
  updated_at: "수정일",
  updatedAt: "수정일",
  created_at: "생성일",
  createdAt: "생성일",
};

const DEFAULT_TABLE_CONFIG: Record<
  ManagementKind,
  {
    visibleColumnIds: string[];
    sorting: SortingState;
    grouping: GroupingState;
  }
> = {
  students: {
    visibleColumnIds: ["title", "badge", "status", "raw:school", "raw:contact", "raw:parent_contact"],
    sorting: [
      { id: "badge", desc: false },
      { id: "title", desc: false },
    ],
    grouping: ["badge"],
  },
  classes: {
    visibleColumnIds: ["title", "badge", "status", "raw:teacher", "raw:schedule", "raw:capacity", "metaSummary"],
    sorting: [
      { id: "status", desc: false },
      { id: "title", desc: false },
    ],
    grouping: ["badge", "status"],
  },
  textbooks: {
    visibleColumnIds: ["title", "badge", "status", "raw:price", "raw:tags", "raw:updated_at", "raw:updatedAt"],
    sorting: [
      { id: "badge", desc: false },
      { id: "title", desc: false },
    ],
    grouping: ["badge"],
  },
};

type SavedPreferences = {
  version: number;
  columnVisibility: VisibilityState;
  columnOrder: ColumnOrderState;
  sorting: SortingState;
  grouping: GroupingState;
};

type ColumnOption = {
  id: string;
  label: string;
};

function getInitials(value: string) {
  const cleaned = value.trim();
  if (!cleaned) {
    return "NA";
  }

  return cleaned.slice(0, 2).toUpperCase();
}

function getStatusColor(value: string) {
  if (value === "수업 진행 중" || value === "assigned" || value === "has-lessons") {
    return "text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/20";
  }

  if (value === "개강 준비 중" || value === "waitlist") {
    return "text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-900/20";
  }

  if (value === "unassigned" || value === "no-lessons" || value === "종강") {
    return "text-gray-600 bg-gray-50 dark:text-gray-400 dark:bg-gray-900/20";
  }

  return "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/20";
}

function prettifyColumnKey(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
}

function formatColumnLabel(columnId: string, badgeLabel: string, statusLabel: string) {
  if (columnId === "title") return "이름";
  if (columnId === "subtitle") return "기본 정보";
  if (columnId === "badge") return badgeLabel;
  if (columnId === "status") return statusLabel;
  if (columnId === "metaSummary") return "상세";
  if (columnId.startsWith("raw:")) {
    const rawKey = columnId.slice(4);
    return RAW_COLUMN_LABELS[rawKey] || prettifyColumnKey(rawKey);
  }
  return prettifyColumnKey(columnId);
}

function normalizeScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeScalar(entry)).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[object]";
    }
  }
  return String(value);
}

function renderValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">-</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground">[]</span>;
    }

    if (value.every((entry) => typeof entry !== "object" || entry === null)) {
      return <span className="text-sm">{value.map((entry) => normalizeScalar(entry)).join(", ")}</span>;
    }

    return (
      <pre className="max-w-[28rem] overflow-hidden text-ellipsis whitespace-pre-wrap break-all text-xs text-muted-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  if (typeof value === "object") {
    return (
      <pre className="max-w-[28rem] overflow-hidden text-ellipsis whitespace-pre-wrap break-all text-xs text-muted-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  if (typeof value === "boolean") {
    return <span>{value ? "true" : "false"}</span>;
  }

  return <span className="text-sm">{String(value)}</span>;
}

function buildDefaultVisibility(kind: ManagementKind, columnIds: string[]) {
  const recommendedVisibleColumnIds = new Set(DEFAULT_TABLE_CONFIG[kind].visibleColumnIds);
  const visibility: VisibilityState = {};

  for (const columnId of columnIds) {
    if (columnId === "select") {
      visibility[columnId] = true;
      continue;
    }

    visibility[columnId] = recommendedVisibleColumnIds.has(columnId);
  }

  return visibility;
}

function buildDefaultSorting(kind: ManagementKind, columnIds: string[]) {
  const allowedColumnIds = new Set(columnIds);
  return DEFAULT_TABLE_CONFIG[kind].sorting.filter((item) => allowedColumnIds.has(item.id));
}

function buildDefaultGrouping(kind: ManagementKind, columnIds: string[]) {
  const allowedColumnIds = new Set(columnIds);
  return DEFAULT_TABLE_CONFIG[kind].grouping.filter((columnId) => allowedColumnIds.has(columnId));
}

function buildDefaultColumnOrder(kind: ManagementKind, columnIds: string[]) {
  const preferredColumnIds = DEFAULT_TABLE_CONFIG[kind].visibleColumnIds;
  const ordered = preferredColumnIds.filter((columnId) => columnIds.includes(columnId));
  return [...new Set(["select", ...ordered, ...columnIds])];
}

function sanitizePreferences(
  kind: ManagementKind,
  rawValue: unknown,
  columnIds: string[],
  defaultVisibility: VisibilityState,
): SavedPreferences {
  const fallback: SavedPreferences = {
    version: STORAGE_VERSION,
    columnVisibility: defaultVisibility,
    columnOrder: buildDefaultColumnOrder(kind, columnIds),
    sorting: buildDefaultSorting(kind, columnIds),
    grouping: buildDefaultGrouping(kind, columnIds),
  };

  if (!rawValue || typeof rawValue !== "object") {
    return fallback;
  }

  const saved = rawValue as Partial<SavedPreferences>;
  const allowedColumnIds = new Set(columnIds);
  const savedVisibilityEntries = Object.entries(saved.columnVisibility || {}).filter(([columnId]) =>
    allowedColumnIds.has(columnId),
  );
  const columnVisibility: VisibilityState = {
    ...defaultVisibility,
    ...Object.fromEntries(savedVisibilityEntries),
  };
  const columnOrder = [
    ...new Set([...(saved.columnOrder || []).filter((columnId) => allowedColumnIds.has(columnId)), ...columnIds]),
  ];
  const sorting = (saved.sorting || []).filter((item) => allowedColumnIds.has(item.id)).slice(0, 2);
  const grouping = (saved.grouping || []).filter((columnId) => allowedColumnIds.has(columnId)).slice(0, 2);

  return {
    version: STORAGE_VERSION,
    columnVisibility,
    columnOrder,
    sorting,
    grouping,
  };
}

function reorderColumns(columnOrder: ColumnOrderState, columnId: string, direction: "up" | "down") {
  const currentIndex = columnOrder.indexOf(columnId);
  if (currentIndex === -1) {
    return columnOrder;
  }

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= columnOrder.length) {
    return columnOrder;
  }

  const next = [...columnOrder];
  const [moved] = next.splice(currentIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

function buildGroupingValue(first: string, second: string) {
  return [first, second].filter(Boolean).slice(0, 2);
}

function buildSortingValue(
  firstColumn: string,
  firstDirection: "asc" | "desc",
  secondColumn: string,
  secondDirection: "asc" | "desc",
): SortingState {
  return [
    firstColumn ? { id: firstColumn, desc: firstDirection === "desc" } : null,
    secondColumn ? { id: secondColumn, desc: secondDirection === "desc" } : null,
  ].filter(Boolean) as SortingState;
}

const WORKSPACE_META: Record<ManagementKind, { title: string }> = {
  students: {
    title: "학생 관리",
  },
  classes: {
    title: "수업 관리",
  },
  textbooks: {
    title: "교재 관리",
  },
};

export function ManagementDataTable({
  kind,
  rows,
  stats,
  loading,
  onRefresh,
  badgeLabel,
  statusLabel,
  emptyLabel,
}: {
  kind: ManagementKind;
  rows: ManagementRow[];
  stats: ManagementStat[];
  loading: boolean;
  onRefresh: () => void;
  badgeLabel: string;
  statusLabel: string;
  emptyLabel: string;
}) {
  const storageKey = `tips-management-table:${kind}:v${STORAGE_VERSION}`;
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [rowSelection, setRowSelection] = useState({});
  const [globalFilter, setGlobalFilter] = useState("");
  const [grouping, setGrouping] = useState<GroupingState>([]);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hydratedStorageKey, setHydratedStorageKey] = useState("");

  const rawColumnKeys = useMemo(
    () =>
      [...new Set(rows.flatMap((row) => Object.keys((row.raw || {}) as Record<string, unknown>)))].sort((left, right) =>
        left.localeCompare(right, "ko"),
      ),
    [rows],
  );

  const columns = useMemo<ColumnDef<ManagementRow>[]>(() => {
    const fixedColumns: ColumnDef<ManagementRow>[] = [
      {
        id: "select",
        header: ({ table }) => (
          <div className="flex items-center justify-center px-2">
            <Checkbox
              checked={
                table.getIsAllPageRowsSelected() ||
                (table.getIsSomePageRowsSelected() && "indeterminate")
              }
              onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
              aria-label="현재 페이지 전체 선택"
            />
          </div>
        ),
        cell: ({ row }) => (
          <div className="flex items-center justify-center px-2">
            <Checkbox
              checked={row.getIsSelected()}
              onCheckedChange={(value) => row.toggleSelected(!!value)}
              aria-label={`${emptyLabel} 항목 선택`}
            />
          </div>
        ),
        enableSorting: false,
        enableHiding: false,
        enableGrouping: false,
        size: 50,
      },
      {
        id: "title",
        accessorFn: (row) => row.title,
        header: "이름",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs font-medium">{getInitials(row.original.title)}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="font-medium">{row.original.title}</span>
              <span className="text-sm text-muted-foreground">{row.original.subtitle}</span>
            </div>
          </div>
        ),
        filterFn: (row, _, value) => {
          const normalized = String(value || "").trim().toLowerCase();
          if (!normalized) {
            return true;
          }

          return row.original.searchText.toLowerCase().includes(normalized);
        },
      },
      {
        id: "subtitle",
        accessorFn: (row) => row.subtitle,
        header: "보조 정보",
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.subtitle || "-"}</span>,
      },
      {
        id: "badge",
        accessorFn: (row) => row.badge,
        header: badgeLabel,
        cell: ({ row }) => <Badge variant="secondary">{row.original.badge}</Badge>,
        filterFn: (row, columnId, value) => !value || row.getValue(columnId) === value,
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: statusLabel,
        cell: ({ row }) => (
          <Badge variant="secondary" className={getStatusColor(row.original.statusValue)}>
            {row.original.status}
          </Badge>
        ),
        filterFn: (row, columnId, value) => !value || row.getValue(columnId) === value,
      },
      {
        id: "metaSummary",
        accessorFn: (row) => row.metaSummary,
        header: "상세",
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.metaSummary || "추가 정보 없음"}</span>,
      },
    ];

    const rawColumns: ColumnDef<ManagementRow>[] = rawColumnKeys.map((key) => ({
      id: `raw:${key}`,
      accessorFn: (row) => normalizeScalar((row.raw || {})[key]),
      header: formatColumnLabel(`raw:${key}`, badgeLabel, statusLabel),
      cell: ({ row }) => renderValue((row.original.raw || {})[key]),
    }));

    return [...fixedColumns, ...rawColumns];
  }, [badgeLabel, emptyLabel, rawColumnKeys, statusLabel]);

  const allColumnIds = useMemo(() => columns.map((column) => String(column.id ?? "")).filter(Boolean), [columns]);

  const defaultVisibility = useMemo(() => buildDefaultVisibility(kind, allColumnIds), [allColumnIds, kind]);

  useEffect(() => {
    const fallback = sanitizePreferences(kind, null, allColumnIds, defaultVisibility);
    setHydratedStorageKey("");

    try {
      const rawSaved = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
      const parsed = rawSaved ? JSON.parse(rawSaved) : null;
      const sanitized = sanitizePreferences(kind, parsed, allColumnIds, defaultVisibility);
      setColumnVisibility(sanitized.columnVisibility);
      setColumnOrder(sanitized.columnOrder);
      setSorting(sanitized.sorting);
      setGrouping(sanitized.grouping);
    } catch {
      setColumnVisibility(fallback.columnVisibility);
      setColumnOrder(fallback.columnOrder);
      setSorting(fallback.sorting);
      setGrouping(fallback.grouping);

      if (typeof window !== "undefined") {
        window.localStorage.removeItem(storageKey);
      }
    }

    setHydratedStorageKey(storageKey);
  }, [allColumnIds, defaultVisibility, kind, storageKey]);

  useEffect(() => {
    if (typeof window === "undefined" || hydratedStorageKey !== storageKey) {
      return;
    }

    const nextValue: SavedPreferences = {
      version: STORAGE_VERSION,
      columnVisibility,
      columnOrder,
      sorting,
      grouping,
    };

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(nextValue));
    } catch {
      // Ignore storage write failures and keep the current in-memory workspace state.
    }
  }, [columnOrder, columnVisibility, grouping, hydratedStorageKey, sorting, storageKey]);

  const table = useReactTable({
    data: rows,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onRowSelectionChange: setRowSelection,
    onGroupingChange: setGrouping,
    onExpandedChange: setExpanded,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      columnOrder,
      rowSelection,
      globalFilter,
      grouping,
      expanded,
    },
    globalFilterFn: (row, _, value) => {
      const normalized = String(value || "").trim().toLowerCase();
      if (!normalized) {
        return true;
      }

      return row.original.searchText.toLowerCase().includes(normalized);
    },
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  const badgeOptions = useMemo(
    () =>
      [...new Set(rows.map((row) => row.badge).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")),
    [rows],
  );

  const statusOptions = useMemo(
    () =>
      [...new Set(rows.map((row) => row.status).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")),
    [rows],
  );

  const columnOptions = useMemo<ColumnOption[]>(
    () =>
      allColumnIds
        .filter((columnId) => columnId !== "select")
        .map((columnId) => ({
          id: columnId,
          label: formatColumnLabel(columnId, badgeLabel, statusLabel),
        })),
    [allColumnIds, badgeLabel, statusLabel],
  );

  const badgeFilter = (table.getColumn("badge")?.getFilterValue() as string) || "";
  const statusFilter = (table.getColumn("status")?.getFilterValue() as string) || "";
  const filteredRowCount = table.getFilteredRowModel().rows.length;
  const selectedRowCount = table.getFilteredSelectedRowModel().rows.length;
  const visibleColumns = table.getVisibleLeafColumns().filter((column) => column.id !== "select").length;
  const primaryGrouping = grouping[0] || "none";
  const secondaryGrouping = grouping[1] || "none";
  const primarySorting = sorting[0]?.id || "none";
  const secondarySorting = sorting[1]?.id || "none";
  const primarySortDirection = sorting[0]?.desc ? "desc" : "asc";
  const secondarySortDirection = sorting[1]?.desc ? "desc" : "asc";
  const workspaceMeta = WORKSPACE_META[kind];
  const currentPage = table.getState().pagination.pageIndex + 1;
  const totalPages = table.getPageCount() || 1;
  const pageSize = table.getState().pagination.pageSize;
  const visibleRangeStart = filteredRowCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const visibleRangeEnd = filteredRowCount === 0 ? 0 : Math.min(currentPage * pageSize, filteredRowCount);
  const compactStats = stats.filter((stat) => stat.value !== undefined && stat.value !== null).slice(0, 2);

  const resetPreferences = () => {
    setColumnVisibility(defaultVisibility);
    setColumnOrder(buildDefaultColumnOrder(kind, allColumnIds));
    setSorting(buildDefaultSorting(kind, allColumnIds));
    setGrouping(buildDefaultGrouping(kind, allColumnIds));
    setExpanded({});
  };

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/95 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-center">
            <div className="min-w-0 lg:w-[220px]">
              <p className="truncate text-sm font-semibold text-foreground">{workspaceMeta.title}</p>
              <p className="text-xs text-muted-foreground">검색 · 필터 · 컬럼 구성</p>
            </div>
            <div className="relative w-full lg:max-w-sm">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="검색"
                placeholder={`${emptyLabel} 검색`}
                value={globalFilter ?? ""}
                onChange={(event) => setGlobalFilter(String(event.target.value))}
                className="pl-9"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {compactStats.map((stat) => (
              <Badge key={stat.label} variant="outline" className="h-8 px-2 text-xs">
                {stat.label} {stat.value}
              </Badge>
            ))}
            <Badge variant="outline" className="h-8 px-2 text-xs">표시 {filteredRowCount}건</Badge>
            <Badge variant="outline" className="h-8 px-2 text-xs">선택 {selectedRowCount}건</Badge>
            <Button variant="outline" size="sm" className="shrink-0" onClick={onRefresh} disabled={loading}>
              <RefreshCw className="mr-2 size-4" />
              새로고침
            </Button>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div className="space-y-2">
            <Label htmlFor="badge-filter" className="text-sm font-medium">
              {badgeLabel}
            </Label>
            <Select
              value={badgeFilter || "all"}
              onValueChange={(value) => table.getColumn("badge")?.setFilterValue(value === "all" ? "" : value)}
            >
              <SelectTrigger className="w-full" id="badge-filter">
                <SelectValue placeholder={`${badgeLabel} 선택`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                {badgeOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="status-filter" className="text-sm font-medium">
              {statusLabel}
            </Label>
            <Select
              value={statusFilter || "all"}
              onValueChange={(value) => table.getColumn("status")?.setFilterValue(value === "all" ? "" : value)}
            >
              <SelectTrigger className="w-full" id="status-filter">
                <SelectValue placeholder={`${statusLabel} 선택`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                {statusOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end justify-end gap-2">
            <div className="flex flex-wrap justify-end gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">컬럼 {visibleColumns}개</Badge>
              {grouping.length > 0 ? <Badge variant="outline">그룹 {grouping.length}단</Badge> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-md border">
        <div className="flex items-center justify-end border-b px-3 py-2">
          <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="컬럼 구성" title="컬럼 구성">
                <Settings2 className="mr-2 size-4" />
                컬럼 구성
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="bottom"
              sideOffset={10}
              className="w-[min(96vw,1280px)] max-w-[96vw] rounded-2xl border bg-popover p-0 shadow-2xl"
            >
              <div className="border-b px-6 py-5">
                <h3 className="text-base font-semibold tracking-tight">{emptyLabel} 표 설정</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  컬럼 보기/숨기기, 순서, 정렬, 그룹화를 조정하면 브라우저에 자동 저장됩니다.
                </p>
              </div>

              <div className="max-h-[80vh] overflow-y-auto px-6 py-5">
                <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
                  <div className="space-y-4">
                    <div className="rounded-2xl border p-4">
                      <h3 className="text-sm font-semibold">그룹화</h3>
                      <p className="mt-1 text-xs text-muted-foreground">최대 2단까지 묶어 볼 수 있습니다.</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>1단 그룹</Label>
                          <Select
                            value={primaryGrouping}
                            onValueChange={(value) => setGrouping(buildGroupingValue(value === "none" ? "" : value, secondaryGrouping === "none" ? "" : secondaryGrouping === value ? "" : secondaryGrouping))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="없음" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">없음</SelectItem>
                              {columnOptions.map((option) => (
                                <SelectItem key={option.id} value={option.id}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>2단 그룹</Label>
                          <Select
                            value={secondaryGrouping}
                            onValueChange={(value) => setGrouping(buildGroupingValue(primaryGrouping === "none" ? "" : primaryGrouping, value === "none" || value === primaryGrouping ? "" : value))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="없음" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">없음</SelectItem>
                              {columnOptions
                                .filter((option) => option.id !== primaryGrouping)
                                .map((option) => (
                                  <SelectItem key={option.id} value={option.id}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border p-4">
                      <h3 className="text-sm font-semibold">정렬</h3>
                      <p className="mt-1 text-xs text-muted-foreground">최대 2단까지 저장합니다.</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>1차 컬럼</Label>
                          <Select
                            value={primarySorting}
                            onValueChange={(value) => setSorting(buildSortingValue(value === "none" ? "" : value, primarySortDirection as "asc" | "desc", secondarySorting === "none" ? "" : secondarySorting === value ? "" : secondarySorting, secondarySortDirection as "asc" | "desc"))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="없음" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">없음</SelectItem>
                              {columnOptions.map((option) => (
                                <SelectItem key={option.id} value={option.id}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>1차 방향</Label>
                          <Select
                            value={primarySortDirection}
                            onValueChange={(value) => setSorting(buildSortingValue(primarySorting === "none" ? "" : primarySorting, value as "asc" | "desc", secondarySorting === "none" ? "" : secondarySorting, secondarySortDirection as "asc" | "desc"))}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="asc">오름차순</SelectItem>
                              <SelectItem value="desc">내림차순</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>2차 컬럼</Label>
                          <Select
                            value={secondarySorting}
                            onValueChange={(value) => setSorting(buildSortingValue(primarySorting === "none" ? "" : primarySorting, primarySortDirection as "asc" | "desc", value === "none" || value === primarySorting ? "" : value, secondarySortDirection as "asc" | "desc"))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="없음" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">없음</SelectItem>
                              {columnOptions
                                .filter((option) => option.id !== primarySorting)
                                .map((option) => (
                                  <SelectItem key={option.id} value={option.id}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>2차 방향</Label>
                          <Select
                            value={secondarySortDirection}
                            onValueChange={(value) => setSorting(buildSortingValue(primarySorting === "none" ? "" : primarySorting, primarySortDirection as "asc" | "desc", secondarySorting === "none" ? "" : secondarySorting, value as "asc" | "desc"))}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="asc">오름차순</SelectItem>
                              <SelectItem value="desc">내림차순</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border p-4 xl:min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">컬럼 구성</h3>
                        <p className="mt-1 text-xs text-muted-foreground">표시 여부와 순서를 저장합니다.</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={resetPreferences}>
                        기본값으로 복원
                      </Button>
                    </div>

                    <div className="mt-4 grid gap-2 md:grid-cols-2">
                      {columnOrder
                        .filter((columnId) => columnId !== "select")
                        .map((columnId, index, orderedIds) => {
                          const option = columnOptions.find((item) => item.id === columnId);
                          const column = table.getColumn(columnId);
                          if (!option || !column) {
                            return null;
                          }

                          return (
                            <div key={columnId} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2">
                              <div className="flex min-w-0 items-center gap-3">
                                <Checkbox
                                  checked={column.getIsVisible()}
                                  onCheckedChange={(value) => column.toggleVisibility(!!value)}
                                  disabled={!column.getCanHide()}
                                />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{option.label}</p>
                                  <p className="truncate text-xs text-muted-foreground">{columnId.startsWith("raw:") ? "DB 원본 열" : "기본 열"}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setColumnOrder((current) => reorderColumns(current, columnId, "up"))}
                                  disabled={index === 0}
                                >
                                  <ArrowUp className="size-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setColumnOrder((current) => reorderColumns(current, columnId, "down"))}
                                  disabled={index === orderedIds.length - 1}
                                >
                                  <ArrowDown className="size-4" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <Table>
          <caption className="sr-only">{emptyLabel} 운영 목록</caption>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, index) => (
                <TableRow key={`loading-${index}`}>
                  <TableCell colSpan={table.getVisibleLeafColumns().length || columns.length}>
                    <Skeleton className="h-10 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                  {row.getVisibleCells().map((cell) => {
                    if (cell.getIsGrouped()) {
                      return (
                        <TableCell key={cell.id}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto px-0 py-0 font-normal"
                            onClick={row.getToggleExpandedHandler()}
                          >
                            {row.getIsExpanded() ? <ChevronDown className="mr-2 size-4" /> : <ChevronRight className="mr-2 size-4" />}
                            <span className="max-w-[18rem] truncate">{String(cell.getValue() || "값 없음")}</span>
                            <Badge variant="secondary" className="ml-2">{row.subRows.length}</Badge>
                          </Button>
                        </TableCell>
                      );
                    }

                    if (cell.getIsPlaceholder()) {
                      return <TableCell key={cell.id} />;
                    }

                    if (cell.getIsAggregated()) {
                      return (
                        <TableCell key={cell.id}>
                          <span className="text-xs text-muted-foreground">{row.subRows.length}건</span>
                        </TableCell>
                      );
                    }

                    return <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>;
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={table.getVisibleLeafColumns().length || columns.length} className="h-40">
                  <div className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-8 text-center">
                    <Badge variant="outline">운영 목록 준비 상태</Badge>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold">현재 조건에 맞는 {emptyLabel} 데이터가 없습니다.</p>
                      <p className="text-sm text-muted-foreground">검색어와 필터 기준에 따라 목록을 비워 둔 상태입니다.</p>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">페이지 이동</p>
          <p>
            페이지 {currentPage} / {totalPages}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            표시 범위 {visibleRangeStart}–{visibleRangeEnd}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            이전
          </Button>
          <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            다음
          </Button>
        </div>
      </div>
    </div>
  );
}
