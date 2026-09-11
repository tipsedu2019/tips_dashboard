"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  DataTableColumnVisibilitySetting,
  DataTableSettings,
  DataTableSettingsSection,
} from "@/components/data-table/data-table-settings";

export type DataTableColumn = {
  id: string;
  label: string;
  required?: boolean;
};

export type DataTableColumnsOptions = {
  ready?: boolean;
  title?: string;
};

const subscribeToHydration = () => () => undefined;
const getHydratedSnapshot = () => true;
const getServerHydratedSnapshot = () => false;

function buildDefaultVisibility(columns: DataTableColumn[]) {
  return Object.fromEntries(columns.map((column) => [column.id, true])) as Record<string, boolean>;
}

function sanitizeVisibility(columns: DataTableColumn[], value: unknown) {
  const defaultVisibility = buildDefaultVisibility(columns);
  if (!value || typeof value !== "object") {
    return defaultVisibility;
  }

  const saved = value as Record<string, unknown>;
  return Object.fromEntries(
    columns.map((column) => [
      column.id,
      column.required ? true : typeof saved[column.id] === "boolean" ? Boolean(saved[column.id]) : true,
    ]),
  ) as Record<string, boolean>;
}

function readInitialVisibility(storageKey: string, columns: DataTableColumn[]): Record<string, unknown> {
  if (typeof window === "undefined") {
    return buildDefaultVisibility(columns);
  }

  try {
    const rawValue = window.localStorage.getItem(storageKey);
    if (!rawValue) {
      return buildDefaultVisibility(columns);
    }
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : buildDefaultVisibility(columns);
  } catch {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Table settings are convenience state only.
    }
    return buildDefaultVisibility(columns);
  }
}

export function useDataTableColumns(
  storageKey: string,
  columns: DataTableColumn[],
  { ready = true, title = "컬럼 구성" }: DataTableColumnsOptions = {},
) {
  const [visibility, setVisibility] = useState<Record<string, unknown>>(() => readInitialVisibility(storageKey, columns));
  const [open, setOpen] = useState(false);
  const hydrated = useSyncExternalStore(subscribeToHydration, getHydratedSnapshot, getServerHydratedSnapshot);
  const columnById = useMemo(() => new Map(columns.map((column) => [column.id, column])), [columns]);
  const defaultVisibility = useMemo(() => buildDefaultVisibility(columns), [columns]);
  const sanitizedVisibility = useMemo(() => sanitizeVisibility(columns, visibility), [columns, visibility]);
  const exposedVisibility = hydrated ? sanitizedVisibility : defaultVisibility;
  const requiredColumns = useMemo(() => columns.filter((column) => column.required), [columns]);
  const optionalColumns = useMemo(() => columns.filter((column) => !column.required), [columns]);

  useEffect(() => {
    if (!hydrated || !ready || typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(sanitizedVisibility));
    } catch {
      // Table settings are convenience state only.
    }
  }, [hydrated, ready, sanitizedVisibility, storageKey]);

  const isColumnVisible = useCallback(
    (columnId: string) => Boolean(exposedVisibility[columnId]),
    [exposedVisibility],
  );
  const visibleColumnCount = columns.filter((column) => isColumnVisible(column.id)).length || 1;
  const resetVisibility = useCallback(() => setVisibility(buildDefaultVisibility(columns)), [columns]);

  const toggleColumn = useCallback((columnId: string, checked: boolean) => {
    const column = columnById.get(columnId);
    if (column?.required) {
      return;
    }
    setVisibility((current) => ({ ...current, [columnId]: checked }));
  }, [columnById]);

  const requiredColumnLabels = requiredColumns.map((column) => column.label).join(", ");

  const columnSettingsControl = (
    <DataTableSettings
      title={title}
      triggerLabel="컬럼 구성"
      triggerClassName="shrink-0 max-sm:size-11"
      open={open}
      onOpenChange={setOpen}
      onReset={resetVisibility}
    >
      <DataTableSettingsSection
        title="컬럼 표시"
        meta={<span className="text-xs tabular-nums text-muted-foreground">{visibleColumnCount} / {columns.length} 표시</span>}
      >
        {requiredColumns.length > 0 ? (
          <div
            className="grid gap-0.5 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
            aria-label={`필수 컬럼 ${requiredColumns.length}개 고정: ${requiredColumnLabels}`}
          >
            <span className="font-medium text-foreground">필수 {requiredColumns.length}개 고정</span>
            <span className="break-words leading-5">{requiredColumnLabels}</span>
          </div>
        ) : null}
        {optionalColumns.length > 0 ? (
          <div className="-my-1 divide-y divide-border/40">
            {optionalColumns.map((column) => (
              <DataTableColumnVisibilitySetting
                key={column.id}
                label={column.label}
                visible={isColumnVisible(column.id)}
                onVisibleChange={(checked) => toggleColumn(column.id, checked)}
              />
            ))}
          </div>
        ) : (
          <p className="py-2 text-sm text-muted-foreground">변경할 수 있는 컬럼이 없습니다.</p>
        )}
      </DataTableSettingsSection>
    </DataTableSettings>
  );

  return { isColumnVisible, visibleColumnCount, columnSettingsControl };
}
