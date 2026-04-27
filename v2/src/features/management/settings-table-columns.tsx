"use client";

import { useEffect, useMemo, useState } from "react";
import { Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type SettingsTableColumn = {
  id: string;
  label: string;
  required?: boolean;
};

function buildDefaultVisibility(columns: SettingsTableColumn[]) {
  return Object.fromEntries(columns.map((column) => [column.id, true])) as Record<string, boolean>;
}

function sanitizeVisibility(columns: SettingsTableColumn[], value: unknown) {
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

export function useSettingsTableColumns(storageKey: string, columns: SettingsTableColumn[]) {
  const [visibility, setVisibility] = useState<Record<string, boolean>>(() => buildDefaultVisibility(columns));
  const [open, setOpen] = useState(false);
  const columnById = useMemo(() => new Map(columns.map((column) => [column.id, column])), [columns]);

  useEffect(() => {
    try {
      const rawValue = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
      setVisibility(sanitizeVisibility(columns, rawValue ? JSON.parse(rawValue) : null));
    } catch {
      setVisibility(buildDefaultVisibility(columns));
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(storageKey);
      }
    }
  }, [columns, storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(visibility));
    } catch {
      // Table settings are convenience state only.
    }
  }, [storageKey, visibility]);

  const isColumnVisible = (columnId: string) => Boolean(visibility[columnId]);
  const visibleColumnCount = columns.filter((column) => isColumnVisible(column.id)).length || 1;
  const resetVisibility = () => setVisibility(buildDefaultVisibility(columns));

  const toggleColumn = (columnId: string, checked: boolean) => {
    const column = columnById.get(columnId);
    if (column?.required) {
      return;
    }
    setVisibility((current) => ({ ...current, [columnId]: checked }));
  };

  const columnSettingsControl = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="icon" className="size-9 shrink-0" aria-label="컬럼 구성" title="컬럼 구성">
          <Settings2 className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-64 rounded-xl p-2">
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <div className="text-sm font-semibold text-foreground">컬럼 구성</div>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={resetVisibility}>
            초기화
          </Button>
        </div>
        <div className="grid gap-0.5">
          {columns.map((column) => (
            <label
              key={column.id}
              className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted/70"
            >
              <Checkbox
                checked={isColumnVisible(column.id)}
                disabled={column.required}
                onCheckedChange={(checked) => toggleColumn(column.id, checked === true)}
              />
              <span className="min-w-0 flex-1 truncate">{column.label}</span>
              {column.required ? <span className="text-[11px] text-muted-foreground">고정</span> : null}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );

  return { isColumnVisible, visibleColumnCount, columnSettingsControl };
}
