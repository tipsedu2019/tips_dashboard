"use client";

import { ListFilter, Rows3, Search, X } from "lucide-react";

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

const ALL_VALUE = "__all__";

type ToolbarOption = string | { value: string; label: string };

export type ToolbarFilter = {
  label: string;
  value: string;
  options: ToolbarOption[];
  placeholder: string;
  onChange: (value: string) => void;
};

type AcademicFilterToolbarProps = {
  title?: string;
  searchValue: string;
  searchPlaceholder: string;
  onSearchChange: (value: string) => void;
  filters: ToolbarFilter[];
  onReset?: () => void;
  showReset?: boolean;
};

function iconForFilter(label: string) {
  if (label.includes("그룹")) {
    return <Rows3 className="size-3.5" />;
  }

  return <ListFilter className="size-3.5" />;
}

export function AcademicFilterToolbar({
  searchValue,
  searchPlaceholder,
  onSearchChange,
  filters,
  onReset,
  showReset = false,
}: AcademicFilterToolbarProps) {
  const resolveOption = (option: ToolbarOption) =>
    typeof option === "string"
      ? { value: option, label: option }
      : { value: option.value, label: option.label };

  const activeFilterCount = filters.filter((filter) => Boolean(filter.value)).length;
  const hasGrouping = filters.some((filter) => filter.label.includes("그룹"));

  return (
    <div className="flex flex-col gap-3 border border-border/70 bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="h-7 gap-1.5 px-2 text-xs">
            <Search className="size-3.5" />
            검색
          </Badge>
          <Badge variant="outline" className="h-7 gap-1.5 px-2 text-xs">
            <ListFilter className="size-3.5" />
            필터 {activeFilterCount}
          </Badge>
          {hasGrouping ? (
            <Badge variant="outline" className="h-7 gap-1.5 px-2 text-xs">
              <Rows3 className="size-3.5" />
              그룹 기준 포함
            </Badge>
          ) : null}
        </div>

        {showReset && onReset ? (
          <Button type="button" variant="ghost" size="sm" onClick={onReset} className="h-8 px-2 text-xs">
            <X className="mr-1 size-3.5" />
            조건 초기화
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,0.7fr))] xl:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,0.72fr))]">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-10 pl-9"
          />
        </div>

        {filters.map((filter) => (
          <div key={filter.label} className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground" title={filter.label}>
              {iconForFilter(filter.label)}
              <span>{filter.label}</span>
            </div>
            <Select
              value={filter.value || ALL_VALUE}
              onValueChange={(nextValue) =>
                filter.onChange(nextValue === ALL_VALUE ? "" : nextValue)
              }
            >
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder={filter.placeholder} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>{filter.placeholder}</SelectItem>
                {filter.options.map((option) => {
                  const resolved = resolveOption(option);

                  return (
                    <SelectItem key={resolved.value} value={resolved.value}>
                      {resolved.label}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
  );
}
