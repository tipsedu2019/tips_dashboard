"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

export type DataTableActiveFilter = { label: string; value: string };

/** One mounted set of controls; mobile conditions never add rows above the list. */
export function DataTableFilterPanel({
  label = "검색 조건",
  activeFilters,
  onReset,
  canReset = activeFilters.length > 0,
  children,
}: {
  label?: string;
  activeFilters: DataTableActiveFilter[];
  onReset?: () => void;
  canReset?: boolean;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const desktopFiltersRef = useRef<HTMLDivElement>(null);
  const summary = activeFilters.map((filter) => filter.value).join(" · ");
  const accessibleSummary = activeFilters.map((filter) => `${filter.label}: ${filter.value}`).join(", ");

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const closeOnResize = () => setOpen(false);
    media.addEventListener("change", closeOnResize);
    return () => media.removeEventListener("change", closeOnResize);
  }, []);

  return (
    <Sheet open={isMobile && open} onOpenChange={setOpen}>
      <div data-slot="data-table-mobile-filters" className="flex h-11 min-w-0 items-center gap-3 md:hidden">
        <SheetTrigger asChild>
          <Button type="button" variant={activeFilters.length ? "secondary" : "outline"} className="h-11"
            aria-label={`${label} 필터${accessibleSummary ? `, ${accessibleSummary}` : ""}`}>
            <SlidersHorizontal aria-hidden="true" />
            필터
            {activeFilters.length ? <Badge variant="outline" className="px-1.5 py-0 tabular-nums">{activeFilters.length}</Badge> : null}
          </Button>
        </SheetTrigger>
        <span className="min-w-0 truncate text-sm text-muted-foreground" title={accessibleSummary} aria-live="polite">
          {summary || "전체"}
        </span>
      </div>
      {isMobile ? (
        <SheetContent side="bottom" aria-describedby={undefined} className="max-h-[85dvh] gap-0"
          onCloseAutoFocus={(event) => {
            if (window.matchMedia("(min-width: 768px)").matches) {
              event.preventDefault();
              desktopFiltersRef.current?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled])')?.focus({ preventScroll: true });
            }
          }}>
          <SheetHeader className="px-5 py-5"><SheetTitle>{label}</SheetTitle></SheetHeader>
          <div data-slot="data-table-filter-fields" className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-5 [&_[role=combobox]]:h-11 [&_button[aria-haspopup=listbox]]:h-11 [&_[data-slot=data-table-filters]]:grid-cols-1 [&_[data-slot=data-table-filters]]:gap-4">
            {children}
          </div>
          <SheetFooter className="flex-row border-t px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
            {onReset ? <Button type="button" variant="ghost" className="h-11" disabled={!canReset} onClick={onReset}>조건 초기화</Button> : null}
            <SheetClose asChild><Button type="button" className="ml-auto h-11 flex-1">목록 보기</Button></SheetClose>
          </SheetFooter>
        </SheetContent>
      ) : <div ref={desktopFiltersRef} className="hidden md:block">{children}</div>}
    </Sheet>
  );
}
