import type { PropsWithChildren } from "react";

import { cn } from "@/lib/utils";

export const PICKER_FILTER_TRIGGER_CLASS_NAME = "h-8 border-0 bg-background px-2.5 shadow-sm focus:ring-1";

export function PickerFilterSurface({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={cn("grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-2", className)}>
      {children}
    </div>
  );
}

export function PickerFilterField({
  label,
  children,
}: PropsWithChildren<{ label: string }>) {
  return (
    <div className="grid min-w-0 gap-1">
      <span className="px-0.5 text-[11px] font-medium leading-none text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}
