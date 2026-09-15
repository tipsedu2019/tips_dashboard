"use client";

import { useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type TextbookClassificationFilters = { subject: string; category: string; school: string; grade: string };

/** Local draft only. The workspace retains query, reset, navigation and read ownership. */
export function TextbookMobileFilters({ applied, onApply, children }: {
  applied: TextbookClassificationFilters;
  onApply: (filters: TextbookClassificationFilters) => void;
  children: (draft: TextbookClassificationFilters, setDraft: (filters: TextbookClassificationFilters) => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(applied);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const count = Object.values(applied).filter(value => value !== "all").length;
  return <Dialog open={open} onOpenChange={setOpen}>
    <Button ref={triggerRef} type="button" variant="outline" className="mr-auto shrink-0 md:hidden" aria-label={`교재 분류 필터 ${count}`} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => { setDraft({ ...applied }); setOpen(true); }}><SlidersHorizontal aria-hidden="true" />필터 {count}</Button>
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] min-w-0 flex-col overflow-hidden" onCloseAutoFocus={event => { event.preventDefault(); triggerRef.current?.focus({ preventScroll: true }); }}>
      <DialogHeader><DialogTitle>교재 분류 필터</DialogTitle><DialogDescription className="sr-only">조건을 선택하고 적용하세요.</DialogDescription></DialogHeader>
      <form className="flex min-h-0 flex-col gap-5" onSubmit={event => { event.preventDefault(); onApply(draft); setOpen(false); }}>
        <div className="min-h-0 overflow-y-auto">{children(draft, setDraft)}</div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(false)}>취소</Button>
          <Button type="submit" className="h-11">적용</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
