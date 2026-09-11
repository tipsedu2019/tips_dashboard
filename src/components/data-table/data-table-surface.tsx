"use client";

import type { CSSProperties, ReactNode } from "react";
import { forwardRef } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const DATA_TABLE_LAYOUT_CLASS_NAME =
  "w-full overflow-hidden rounded-lg border border-border/70 bg-background shadow-xs";
export const DATA_TABLE_TOOLBAR_CLASS_NAME =
  "flex flex-col gap-3 rounded-none border-x-0 border-t-0 border-b border-border/70 bg-background px-3 py-3 shadow-none sm:px-4";
export const DATA_TABLE_FILTER_FIELD_CLASS_NAME = "grid min-w-0 gap-1.5 sm:w-40";
export const DATA_TABLE_VIEWPORT_CLASS_NAME =
  "overflow-auto [scrollbar-gutter:stable] rounded-none border-0 bg-background shadow-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring";
export const DATA_TABLE_TABLE_CLASS_NAME = "min-w-[980px] table-fixed";
export const DATA_TABLE_MOBILE_LIST_CLASS_NAME = "grid gap-2 p-3 md:hidden";
export const DATA_TABLE_MOBILE_ITEM_CLASS_NAME =
  "min-w-0 rounded-md border border-border/70 bg-background p-3 data-[state=selected]:border-primary/40 data-[state=selected]:bg-accent";
export const DATA_TABLE_PAGER_CLASS_NAME =
  "flex min-h-12 flex-col gap-2 border-x-0 border-b-0 border-t border-border/70 bg-background px-3 py-2 text-sm shadow-none sm:flex-row sm:items-center sm:justify-between sm:px-4";
export const DATA_TABLE_HEADER_CELL_CLASS_NAME =
  "sticky top-0 h-11 border-b border-border/80 bg-muted px-3 py-1 text-xs font-semibold text-foreground";
export const DATA_TABLE_BODY_CELL_CLASS_NAME = "h-12 px-3 py-2 align-middle";

export type DataTablePinnedColumn = {
  left: number;
  layer?: number;
};

function getPinnedStyle(pin: DataTablePinnedColumn | undefined, style: CSSProperties | undefined) {
  return pin
    ? { ...style, left: `${pin.left}px`, zIndex: pin.layer }
    : style;
}

export function DataTableToolbar({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div data-slot="data-table-toolbar" className={cn(DATA_TABLE_TOOLBAR_CLASS_NAME, className)} {...props}>
      {children}
    </div>
  );
}

export function DataTableFilters({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      role="group"
      aria-label="검색 조건"
      data-slot="data-table-filters"
      className={cn("grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/** Shared two-row layout: search and actions, then conditions and a compact total. */
export function DataTableWorkspaceToolbar({ search, actions, feedback, filters, summary, ...props }: {
  search: ReactNode;
  actions?: ReactNode;
  feedback?: ReactNode;
  filters?: ReactNode;
  summary?: ReactNode;
} & Omit<React.ComponentProps<"div">, "children">) {
  return (
    <DataTableToolbar {...props}>
      <div data-slot="data-table-command-row" className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-center">
        {search}
        <div data-slot="data-table-actions" className="flex h-11 min-w-0 items-center justify-end gap-1 sm:h-9 sm:gap-2 [&_[data-slot=button]]:h-11 sm:[&_[data-slot=button]]:h-9 [&_[data-slot=button][data-size=icon]]:w-11 sm:[&_[data-slot=button][data-size=icon]]:w-9">
          {feedback ?? actions}
        </div>
      </div>
      <div data-slot="data-table-condition-row" className="flex min-h-11 min-w-0 flex-col justify-center gap-2 sm:min-h-9 lg:flex-row lg:items-center lg:justify-between">
        {filters ? <div className="min-w-0 flex-1">{filters}</div> : null}
        {summary ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-live="polite">{summary}</span> : null}
      </div>
    </DataTableToolbar>
  );
}

/** Read failures use the existing command row, so recovery never moves the search or table. */
export function DataTableReadFeedback({ label, message, retryLabel, onRetry, returnFocusRef }: {
  label: string;
  message: string;
  retryLabel: string;
  onRetry: () => unknown;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  return <div role="alert" className="flex min-w-0 items-center gap-2 text-sm">
    <span className="min-w-0 text-destructive" title={message}>{label}</span>
    <span className="sr-only">{message}</span>
    <Button type="button" variant="outline" size="sm" className="shrink-0" aria-label={retryLabel} onClick={() => {
      returnFocusRef?.current?.focus({ preventScroll: true });
      void onRetry();
    }}>다시 시도</Button>
  </div>;
}

export const DataTableViewport = forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  function DataTableViewport({ className, children, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="data-table-viewport"
        className={cn(DATA_TABLE_VIEWPORT_CLASS_NAME, className)}
        {...props}
      >
        {children}
      </div>
    );
  },
);

export function DataTableHeaderCell({
  pin,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"th"> & { pin?: DataTablePinnedColumn }) {
  return (
    <TableHead
      className={cn(
        DATA_TABLE_HEADER_CELL_CLASS_NAME,
        pin && "bg-muted",
        className,
      )}
      style={getPinnedStyle(pin, style)}
      {...props}
    >
      {children}
    </TableHead>
  );
}

export function DataTableHeaderRow({ className, children, ...props }: React.ComponentProps<"tr">) {
  return (
    <TableRow className={cn("h-11 border-b border-border/80 hover:bg-transparent", className)} {...props}>
      {children}
    </TableRow>
  );
}

export function DataTableBodyRow({ className, children, ...props }: React.ComponentProps<"tr">) {
  return (
    <TableRow
      className={cn(
        "group/data-table-row h-12 border-b border-border/70 transition-colors duration-[var(--motion-duration-control)] ease-[var(--motion-easing-control)] hover:bg-muted data-[state=selected]:bg-accent motion-reduce:transition-none last:border-b-0",
        className,
      )}
      {...props}
    >
      {children}
    </TableRow>
  );
}

export function DataTableBodyCell({
  pin,
  wrap = false,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"td"> & {
  pin?: DataTablePinnedColumn;
  wrap?: boolean;
}) {
  return (
    <TableCell
      className={cn(
        DATA_TABLE_BODY_CELL_CLASS_NAME,
        wrap && "whitespace-normal break-words",
        pin && [
          "sticky bg-background",
          "group-hover/data-table-row:bg-muted",
          "group-data-[state=selected]/data-table-row:bg-accent",
        ],
        className,
      )}
      style={getPinnedStyle(pin, style)}
      {...props}
    >
      {children}
    </TableCell>
  );
}

export function DataTableSortButton({
  direction,
  label,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "children"> & {
  direction: false | "asc" | "desc";
  label: string;
  children: ReactNode;
}) {
  const nextDirection = direction === "asc" ? "내림차순" : "오름차순";

  return (
    <button
      type="button"
      data-state={direction ? "sorted" : "unsorted"}
      className={cn(
        "flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left font-semibold transition-colors duration-[var(--motion-duration-control)] ease-[var(--motion-easing-control)] hover:bg-background data-[state=sorted]:bg-background data-[state=sorted]:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        className,
      )}
      aria-label={`${label} ${nextDirection} 정렬`}
      {...props}
    >
      <span className="min-w-0 whitespace-normal break-words leading-4">{children}</span>
      {direction === "asc" ? (
        <ArrowUp className="size-3.5 shrink-0" aria-hidden="true" />
      ) : direction === "desc" ? (
        <ArrowDown className="size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
      )}
    </button>
  );
}
