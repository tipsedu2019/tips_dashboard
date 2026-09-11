"use client";

import { useId, type ComponentProps } from "react";

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
