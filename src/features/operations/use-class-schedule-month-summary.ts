"use client";

import { useEffect, useState } from "react";
import type { ClassScheduleMonthSummary } from "./class-schedule-month-summary.ts";

type Input = { classId: string; year: number };
type Loader = (input: Input) => Promise<ClassScheduleMonthSummary>;
type State = { status: "idle" | "loading" | "error" } | { status: "ready"; value: ClassScheduleMonthSummary };

// The loader is actor-scoped. There is no durable/shared completed-response cache.
export function useClassScheduleMonthSummary(loader: Loader, input: Input | null, refreshKey: string): State {
  const classId = input?.classId;
  const year = input?.year;
  const scope = JSON.stringify([classId, year, refreshKey]);
  const emptyState: State = { status: classId && year ? "loading" : "idle" };
  const [snapshot, setSnapshot] = useState<{ loader: Loader; scope: string; state: State }>(() => ({ loader, scope, state: emptyState }));
  useEffect(() => {
    if (!classId || !year) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      try {
        const value = await loader({ classId, year });
        if (active) setSnapshot({ loader, scope, state: { status: "ready", value } });
      } catch {
        if (active) setSnapshot({ loader, scope, state: { status: "error" } });
      }
    });
    return () => { active = false; };
  }, [classId, year, loader, scope]);
  // Reset during this component's render so a committed intervening scope (or
  // logout) cannot resurrect a formerly ready snapshot on re-entry.
  if (snapshot.loader !== loader || snapshot.scope !== scope) {
    setSnapshot({ loader, scope, state: emptyState });
    return emptyState;
  }
  return snapshot.state;
}
