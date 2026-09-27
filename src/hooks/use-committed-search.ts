"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Typing is local; restored URLs and explicit controls commit immediately.
export function useCommittedSearch(initialValue: string) {
  const [value, setValue] = useState(initialValue);
  const [committed, setCommitted] = useState(initialValue);
  const composing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  const reset = useCallback((next: string) => {
    cancel();
    composing.current = false;
    setValue(next);
    setCommitted(next);
  }, [cancel]);
  const onChange = useCallback((next: string, options?: { syncUrl?: boolean }) => {
    cancel();
    setValue(next);
    if (composing.current || options?.syncUrl === false) return;
    if (!next) { setCommitted(next); return; }
    timer.current = setTimeout(() => { timer.current = null; setCommitted(next); }, 250);
  }, [cancel]);
  return {
    value, committed, reset, onChange,
    onCompositionStart: () => { composing.current = true; cancel(); },
    onCompositionEnd: (next: string) => { composing.current = false; onChange(next); },
    onSubmit: () => { if (!composing.current) reset(value); },
  };
}
