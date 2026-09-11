"use client";

import { useId, useRef, type ReactNode } from "react";
import { ArrowDown, ArrowUp, RotateCcw, Settings2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function DataTableSettings({ title, triggerLabel = "표 설정", triggerClassName, open, onOpenChange, onReset, children }: {
  title: string;
  triggerLabel?: string;
  triggerClassName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReset: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className={cn("size-8 rounded-md data-[state=open]:bg-accent data-[state=open]:text-primary", triggerClassName)} aria-label={triggerLabel} title={triggerLabel}>
          <Settings2 className="size-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end" side="bottom" sideOffset={8} collisionPadding={12}
        aria-labelledby={titleId}
        className="flex max-h-[min(780px,var(--radix-popover-content-available-height))] w-[min(440px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border-border/70 bg-popover p-0 shadow-xl duration-[var(--motion-duration-control)] dark:[color-scheme:dark] motion-reduce:animate-none"
        onOpenAutoFocus={(event) => { event.preventDefault(); closeRef.current?.focus(); }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <h3 id={titleId} className="text-sm font-semibold tracking-tight">{title}</h3>
          <Button ref={closeRef} type="button" variant="ghost" size="icon" className="size-8 rounded-full text-muted-foreground max-sm:size-11" aria-label={`${triggerLabel} 닫기`} onClick={() => onOpenChange(false)}>
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 [scrollbar-gutter:stable]">{children}</div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-muted/30 px-3 py-2">
          <Button type="button" variant="ghost" size="sm" className="h-9 gap-1.5 text-xs text-muted-foreground max-sm:h-11" onClick={onReset}>
            <RotateCcw className="size-3.5" aria-hidden="true" />기본값으로 복원
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-9 px-4 shadow-none max-sm:h-11" onClick={() => onOpenChange(false)}>완료</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function DataTableSettingsSection({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-3 border-b border-border/60 py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <h4 id={headingId} className="text-xs font-semibold text-muted-foreground">{title}</h4>
        {meta}
      </div>
      {children}
    </section>
  );
}

export function DataTableSettingsSelect({ label, value, options, onValueChange, placeholder = "없음" }: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onValueChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger aria-label={label} className="w-full min-w-0 bg-background text-[13px] shadow-none max-sm:data-[size=default]:h-11">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>{options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

export function DataTableColumnSetting({ label, visible, canHide, width, canMoveUp, canMoveDown, onVisibleChange, onWidthChange, onMove }: {
  label: string;
  visible: boolean;
  canHide: boolean;
  width: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onVisibleChange: (visible: boolean) => void;
  onWidthChange: (value: string) => void;
  onMove: (direction: "up" | "down") => void;
}) {
  return (
    <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_4.25rem_4.5rem] items-center gap-2 rounded-md py-1 transition-colors hover:bg-muted/50 motion-reduce:transition-none">
      <label className="flex min-h-9 min-w-0 cursor-pointer items-center gap-2.5 pl-1 text-[13px]">
        <Checkbox checked={visible} onCheckedChange={(value) => onVisibleChange(!!value)} disabled={!canHide} aria-label={`${label} 표시`} className="size-4 shrink-0" />
        <span className="min-w-0 break-words leading-5">{label}</span>
      </label>
      <Input aria-label={`${label} 너비`} type="number" min={72} max={420} step={8} value={width} onChange={(event) => onWidthChange(event.target.value)} className="h-8 min-w-0 bg-background px-2 text-right text-xs tabular-nums shadow-none max-sm:h-11" />
      <div className="flex items-center justify-end">
        <Button type="button" variant="ghost" size="icon" className="size-9 rounded-md text-muted-foreground max-sm:h-11" aria-label={`${label} 앞으로 이동`} title="앞으로 이동" disabled={!canMoveUp} onClick={() => onMove("up")}><ArrowUp className="size-3.5" aria-hidden="true" /></Button>
        <Button type="button" variant="ghost" size="icon" className="size-9 rounded-md text-muted-foreground max-sm:h-11" aria-label={`${label} 뒤로 이동`} title="뒤로 이동" disabled={!canMoveDown} onClick={() => onMove("down")}><ArrowDown className="size-3.5" aria-hidden="true" /></Button>
      </div>
    </div>
  );
}

export function DataTableColumnVisibilitySetting({ label, visible, onVisibleChange }: {
  label: string;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-1 text-[13px] transition-colors hover:bg-muted/50 motion-reduce:transition-none">
      <Checkbox checked={visible} onCheckedChange={(value) => onVisibleChange(!!value)} aria-label={`${label} 표시`} className="size-5 shrink-0" />
      <span className="min-w-0 break-words leading-5">{label}</span>
    </label>
  );
}
