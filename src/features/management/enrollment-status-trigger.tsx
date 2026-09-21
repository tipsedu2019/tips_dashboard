"use client";

import { forwardRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const EnrollmentStatusTrigger = forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button> & { label: string; count: number }>(
  function EnrollmentStatusTrigger({ label, count, className, onClick, ...props }, ref) {
    return <Button ref={ref} type="button" variant={count > 0 ? "secondary" : "ghost"} size="sm"
      className={cn("relative h-11 px-2 text-xs tabular-nums md:h-7", className)}
      onClick={(event) => { event.stopPropagation(); onClick?.(event); }} {...props}>{label} {count}</Button>;
  },
);
