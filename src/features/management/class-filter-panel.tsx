"use client";

import type { ReactNode, Ref } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTableSearchField } from "@/components/data-table/data-table-search-field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DataTableCommandRow, DataTableFilters, DATA_TABLE_FILTER_FIELD_CLASS_NAME } from "@/components/data-table/data-table-surface";
import { DataTableFilterPanel } from "@/components/data-table/data-table-filter-panel";

export type ClassFilterPanelOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type ClassFilterPanelSelect = {
  id: string;
  label: string;
  value: string;
  options: ClassFilterPanelOption[];
  allowEmpty?: boolean;
  emptyValue?: string;
  emptyLabel?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

type ClassFilterPanelProps = {
  selects: ClassFilterPanelSelect[];
  searchValue: string;
  searchPlaceholder: string;
  onSearchChange: (value: string, options?: { syncUrl?: boolean }) => void;
  onSearchSubmit?: () => void;
  onSearchCompositionStart?: () => void;
  onSearchCompositionEnd?: (value: string) => void;
  searchInputRef?: Ref<HTMLInputElement>;
  readFeedback?: ReactNode;
  summaryLabel?: ReactNode;
  showReset?: boolean;
  onReset?: () => void;
  createLabel?: string;
  onCreate?: () => void;
  createDisabled?: boolean;
  footerAction?: ReactNode;
  toolbarAction?: ReactNode;
  selectionActions?: ReactNode;
  className?: string;
};

function normalizeOptions(options: ClassFilterPanelOption[] = []) {
  return options.filter((option) => option.value);
}

export function ClassFilterPanel({
  selects,
  searchValue,
  searchPlaceholder,
  onSearchChange,
  onSearchSubmit,
  onSearchCompositionStart,
  onSearchCompositionEnd,
  searchInputRef,
  readFeedback,
  summaryLabel,
  showReset = false,
  onReset,
  createLabel,
  onCreate,
  createDisabled = false,
  footerAction,
  toolbarAction,
  selectionActions,
  className,
}: ClassFilterPanelProps) {
  const hasCreate = Boolean(createLabel);

  const renderSelectField = (select: ClassFilterPanelSelect) => {
    const options = normalizeOptions(select.options);
    const emptyValue = select.emptyValue || "all";
    const value = select.value || (select.allowEmpty ? emptyValue : options[0]?.value || emptyValue);
    const disabled = select.disabled || (!select.allowEmpty && options.length === 0);

    return (
      <div key={select.id} className={DATA_TABLE_FILTER_FIELD_CLASS_NAME}>
        <Label htmlFor={`${select.id}-filter`} className="text-xs font-medium text-muted-foreground">
          {select.label}
        </Label>
        <Select value={value} disabled={disabled} onValueChange={select.onChange}>
          <SelectTrigger className="h-9 w-full min-w-0" id={`${select.id}-filter`} aria-label={select.label}>
            <SelectValue placeholder={select.label} />
          </SelectTrigger>
          <SelectContent>
            {select.allowEmpty ? (
              <SelectItem value={emptyValue}>{select.emptyLabel || `전체 ${select.label}`}</SelectItem>
            ) : null}
            {!select.allowEmpty && options.length === 0 ? (
              <SelectItem value={emptyValue} disabled>
                {select.emptyLabel || `${select.label} 없음`}
              </SelectItem>
            ) : null}
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <div className={cn("flex flex-col gap-2 border border-border/70 bg-background px-3 py-3", className)}>
      <DataTableCommandRow
        reserveActions={hasCreate || Boolean(toolbarAction) || Boolean(selectionActions) || Boolean(readFeedback)}
        search={<DataTableSearchField ref={searchInputRef}
            label={searchPlaceholder}
            clearLabel={`${searchPlaceholder} 지우기`}
            placeholder={searchPlaceholder}
            value={searchValue}
            onValueChange={(value, detail) => onSearchChange(value, detail ? { syncUrl: !detail.isComposing } : undefined)}
            onSubmit={() => onSearchSubmit?.()}
            onCompositionStart={onSearchCompositionStart}
            onCompositionEnd={onSearchCompositionEnd}
          />}
        actions={<>{readFeedback}{selectionActions ?? <>
        {hasCreate ? (
          <Button
            variant={createDisabled ? "outline" : "default"}
            size="sm"
            className="h-9 shrink-0"
            onClick={onCreate}
            disabled={createDisabled}
          >
            <Plus className="mr-2 size-4" />
            {createLabel}
          </Button>
        ) : null}
        {toolbarAction}
        </>}</>}
      />

      <DataTableFilterPanel label={`${searchPlaceholder} 조건`} onReset={onReset} canReset={showReset}
        activeFilters={selects.flatMap((select) => {
          const value = select.value;
          if (!value || value === (select.emptyValue || "all")) return [];
          return [{ label: select.label, value: select.options.find((option) => option.value === value)?.label || value }];
        })}>
      <DataTableFilters aria-label={`${searchPlaceholder} 조건`}>
        {selects.map(renderSelectField)}
        {showReset ? (
          <div className="hidden h-9 items-center md:ml-auto md:flex">
            <Button type="button" variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={onReset}>
              <X className="mr-1.5 size-3.5" />
              조건 초기화
            </Button>
          </div>
        ) : null}
      </DataTableFilters>
      </DataTableFilterPanel>

      {summaryLabel || footerAction ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          {summaryLabel ? <span>{summaryLabel}</span> : null}
          {footerAction}
        </div>
      ) : null}
    </div>
  );
}
