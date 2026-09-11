"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const DataTableSearchField = forwardRef<HTMLInputElement, {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  clearLabel?: string;
  placeholder?: string;
  shortcut?: string;
  className?: string;
}>(function DataTableSearchField({ value, onValueChange, label, clearLabel = `${label} 초기화`, placeholder, shortcut, className }, ref) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current!, []);
  function clear() {
    onValueChange("");
    inputRef.current?.focus({ preventScroll: true });
  }
  return (
    <div role="search" aria-label={label} data-slot="data-table-search" className={cn("relative min-w-0 flex-1", className)}>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input ref={inputRef} type="search" value={value} onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === "Escape" && value) {
            event.preventDefault();
            event.stopPropagation();
            clear();
          }
        }}
        aria-label={label} aria-keyshortcuts={shortcut} autoComplete="off" enterKeyHint="search" placeholder={placeholder}
        className="h-11 pl-9 pr-11 sm:h-9 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none" />
      <Button type="button" variant="ghost" size="icon" aria-label={clearLabel} disabled={!value}
        className={cn("absolute right-0 top-0 size-11 sm:right-0.5 sm:top-0.5 sm:size-8", !value && "invisible")}
        onClick={clear}><X aria-hidden="true" className="size-4" /></Button>
    </div>
  );
});
