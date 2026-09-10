"use client";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DATA_TABLE_FILTER_FIELD_CLASS_NAME } from "./data-table-surface";

type FilterOption<T extends string> = { value: T; label: string; count?: number | null };

export function DataTableSelectFilter<T extends string>({
  id, label, ariaLabel, value, options, onValueChange, inline = false,
}: {
  inline?: boolean;
  id: string;
  label: string;
  ariaLabel: string;
  value: T;
  options: readonly FilterOption<T>[];
  onValueChange: (value: T) => void;
}) {
  return (
    <div className={cn(DATA_TABLE_FILTER_FIELD_CLASS_NAME, inline && "lg:flex lg:w-auto lg:max-w-60 lg:flex-1 lg:items-center lg:gap-2")} data-slot="data-table-select-filter">
      <Label htmlFor={id} className="shrink-0 text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={(next) => onValueChange(next as T)}>
        <SelectTrigger id={id} aria-label={ariaLabel} className={cn("w-full", inline && "min-w-0 data-[size=default]:h-11 sm:data-[size=default]:h-9 lg:w-0 lg:flex-1")}>
          <SelectValue><span>{options.find((option) => option.value === value)?.label ?? ""}</span></SelectValue>
        </SelectTrigger>
        <SelectContent align="start" className="motion-reduce:animate-none">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} textValue={option.label}>
              <span className="flex w-full items-center justify-between gap-4">
                <span>{option.label}</span>
                {option.count !== undefined ? (
                  <span className="min-w-6 text-right text-xs tabular-nums text-muted-foreground">
                    {option.count === null ? "—" : option.count.toLocaleString("ko-KR")}
                  </span>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
