"use client";

import { useId, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function TimetableTargetFilter({
  label,
  options,
  selected,
  onChange,
  optionLabels = {},
}: {
  label: string;
  options: string[];
  optionLabels?: Record<string, string>;
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const filtered = options.filter((option) =>
    (optionLabels[option] || option).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const summary = selected.length ? selected.map(value => optionLabels[value] || value).join(", ") : `전체 ${label}`;
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Popover
        onOpenChange={(open) => {
          if (!open) setSearch("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            className="h-[var(--field-height)] w-full min-w-0 justify-between font-normal"
            aria-label={`${label} 선택: ${summary}`}
          >
            <span className="truncate">{summary}</span>
            <ChevronsUpDown
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(20rem,calc(100vw-2rem))] p-2"
        >
          <Input
            aria-label={`${label} 검색`}
            placeholder={`${label} 검색`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div
            className="mt-2 max-h-60 overflow-y-auto overscroll-contain"
            role="group"
            aria-label={`${label} 선택`}
          >
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-accent">
              <Checkbox
                checked={selected.length === 0}
                onCheckedChange={() => onChange([])}
              />
              <span className="text-sm">전체 {label}</span>
            </label>
            {filtered.map((option) => (
              <label
                key={option}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-accent"
              >
                <Checkbox
                  checked={selected.includes(option)}
                  onCheckedChange={(checked) =>
                    onChange(
                      checked
                        ? [...selected, option]
                        : selected.filter((value) => value !== option),
                    )
                  }
                />
                <span className="min-w-0 break-words text-sm">{optionLabels[option] || option}</span>
              </label>
            ))}
            {!filtered.length ? (
              <p className="px-2 py-4 text-sm text-muted-foreground">
                검색 결과가 없습니다.
              </p>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
