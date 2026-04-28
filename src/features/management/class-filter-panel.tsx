"use client";

import type { ReactNode } from "react";
import { Plus, Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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

export type ClassFilterPanelChip = {
  id: string;
  label: ReactNode;
};

type ClassFilterPanelProps = {
  selects: ClassFilterPanelSelect[];
  searchValue: string;
  searchPlaceholder: string;
  onSearchChange: (value: string) => void;
  summaryLabel?: ReactNode;
  chips?: ClassFilterPanelChip[];
  showReset?: boolean;
  onReset?: () => void;
  createLabel?: string;
  onCreate?: () => void;
  createDisabled?: boolean;
  footerAction?: ReactNode;
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
  summaryLabel,
  chips = [],
  showReset = false,
  onReset,
  createLabel,
  onCreate,
  createDisabled = false,
  footerAction,
  className,
}: ClassFilterPanelProps) {
  const hasCreate = Boolean(createLabel);

  return (
    <div className={cn("flex flex-col gap-2 border border-border/70 bg-background px-3 py-3", className)}>
      <div
        className={cn(
          "grid grid-cols-1 gap-2 md:grid-cols-2",
          hasCreate
            ? "xl:grid-cols-[minmax(9rem,0.8fr)_minmax(9rem,0.8fr)_minmax(8rem,0.7fr)_minmax(8rem,0.7fr)_minmax(9rem,0.85fr)_minmax(9rem,0.85fr)_minmax(14rem,1.35fr)_8.5rem]"
            : "xl:grid-cols-[minmax(9rem,0.8fr)_minmax(9rem,0.8fr)_minmax(8rem,0.7fr)_minmax(8rem,0.7fr)_minmax(9rem,0.85fr)_minmax(9rem,0.85fr)_minmax(14rem,1.35fr)]",
        )}
      >
        {selects.map((select) => {
          const options = normalizeOptions(select.options);
          const emptyValue = select.emptyValue || "all";
          const value = select.value || (select.allowEmpty ? emptyValue : options[0]?.value || emptyValue);
          const disabled = select.disabled || (!select.allowEmpty && options.length === 0);

          return (
            <div key={select.id} className="min-w-0">
              <Label htmlFor={`${select.id}-filter`} className="sr-only">
                {select.label}
              </Label>
              <Select value={value} disabled={disabled} onValueChange={select.onChange}>
                <SelectTrigger className="h-9 w-full" id={`${select.id}-filter`} aria-label={select.label}>
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
        })}

        <div className="relative min-w-0">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="검색"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            className="h-9 pl-9"
          />
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
      </div>

      {summaryLabel || chips.length > 0 || showReset || footerAction ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {summaryLabel ? <Badge variant="secondary">{summaryLabel}</Badge> : null}
          {chips.map((chip) => (
            <Badge key={chip.id} variant="outline">
              {chip.label}
            </Badge>
          ))}
          {showReset ? (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onReset}>
              <X className="mr-1.5 size-3.5" />
              조건 초기화
            </Button>
          ) : null}
          {footerAction}
        </div>
      ) : null}
    </div>
  );
}
