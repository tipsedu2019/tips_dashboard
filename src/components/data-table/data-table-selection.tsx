"use client";

import { useId, type ComponentProps } from "react";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export function DataTableSelectionCheckbox({
  className,
  id,
  ...props
}: ComponentProps<typeof Checkbox>) {
  const generatedId = useId();
  const checkboxId = id ?? generatedId;

  return (
    <label
      htmlFor={checkboxId}
      data-slot="data-table-selection"
      className={cn("flex size-10 shrink-0 cursor-pointer items-center justify-center", className)}
    >
      <Checkbox id={checkboxId} className="size-4 rounded-[4px] shadow-none [&_svg]:size-3" {...props} />
    </label>
  );
}

/** Compact context actions occupy the command lane, never a new row above data. */
export function DataTableSelectionActions({ count, label, onClear, disabled, children }: {
  count: number;
  label: string;
  onClear: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div data-slot="data-table-selection-actions" role="group" aria-label={label}
      className="flex h-full min-w-0 flex-1 items-center gap-1 rounded-[var(--radius-control)] bg-secondary pl-3 text-secondary-foreground">
      <span role="status" className="mr-auto whitespace-nowrap text-sm font-medium tabular-nums text-primary">{count.toLocaleString("ko-KR")}건 선택</span>
      {children}
      <Button type="button" variant="ghost" size="icon" onClick={onClear} disabled={disabled} aria-label="선택 해제" title="선택 해제">
        <X aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}
