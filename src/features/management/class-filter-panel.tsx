"use client";

import type { ChangeEvent, ReactNode } from "react";
import { Plus, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DataTableFilters, DATA_TABLE_FILTER_FIELD_CLASS_NAME } from "@/components/data-table/data-table-surface";

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
  onSearchCompositionStart?: () => void;
  onSearchCompositionEnd?: (value: string) => void;
  summaryLabel?: ReactNode;
  showReset?: boolean;
  onReset?: () => void;
  createLabel?: string;
  onCreate?: () => void;
  createDisabled?: boolean;
  footerAction?: ReactNode;
  toolbarAction?: ReactNode;
  className?: string;
};

function normalizeOptions(options: ClassFilterPanelOption[] = []) {
  return options.filter((option) => option.value);
}

function isComposingSearchInput(event: ChangeEvent<HTMLInputElement>) {
  return "isComposing" in event.nativeEvent && Boolean(event.nativeEvent.isComposing);
}

export function ClassFilterPanel({
  selects,
  searchValue,
  searchPlaceholder,
  onSearchChange,
  onSearchCompositionStart,
  onSearchCompositionEnd,
  summaryLabel,
  showReset = false,
  onReset,
  createLabel,
  onCreate,
  createDisabled = false,
  footerAction,
  toolbarAction,
  className,
}: ClassFilterPanelProps) {
  const hasCreate = Boolean(createLabel);
  const hasSearchValue = searchValue.trim().length > 0;

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
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 basis-full sm:basis-auto sm:flex-1" role="search" aria-label={searchPlaceholder}>
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label={searchPlaceholder}
            autoComplete="off"
            enterKeyHint="search"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value, { syncUrl: !isComposingSearchInput(event) })}
            onCompositionStart={onSearchCompositionStart}
            onCompositionEnd={(event) => onSearchCompositionEnd?.(event.currentTarget.value)}
            className="h-9 pl-9 pr-9"
          />
          {hasSearchValue ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 size-7 -translate-y-1/2 rounded-md active:-translate-y-1/2"
              onClick={() => onSearchChange("")}
              aria-label={`${searchPlaceholder} 지우기`}
            >
              <X className="size-3.5" />
            </Button>
          ) : null}
        </div>

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
      </div>

      <DataTableFilters aria-label={`${searchPlaceholder} 조건`}>
        {selects.map(renderSelectField)}
        {showReset ? (
          <div className="flex h-9 items-center sm:ml-auto">
            <Button type="button" variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={onReset}>
              <X className="mr-1.5 size-3.5" />
              조건 초기화
            </Button>
          </div>
        ) : null}
      </DataTableFilters>

      {summaryLabel || footerAction ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          {summaryLabel ? <span>{summaryLabel}</span> : null}
          {footerAction}
        </div>
      ) : null}
    </div>
  );
}
