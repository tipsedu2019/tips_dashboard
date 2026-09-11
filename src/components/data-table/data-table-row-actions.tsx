"use client";

import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function DataTableDetailButton({ label, children, onClick }: {
  label: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="text"
      className="h-auto min-w-0 max-w-full shrink justify-start whitespace-normal break-words p-0 text-left"
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function DataTableRowActions({ label, primaryAction, disabled = false, children }: {
  label: string;
  primaryAction?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-end gap-1" data-slot="data-table-row-actions">
      {primaryAction}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label={label} disabled={disabled}>
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">{children}</DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
