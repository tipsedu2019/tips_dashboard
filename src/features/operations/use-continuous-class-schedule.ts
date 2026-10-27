"use client";

import { useEffect, useState } from "react";

import type {
  ContinuousScheduleBoundedReadInput,
  ContinuousScheduleBoundedReader,
} from "../academic/continuous-class-schedule-service.ts";

type ContinuousScheduleReadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; value: Awaited<ReturnType<ContinuousScheduleBoundedReader["load"]>> };

export function useContinuousClassSchedule(
  reader: ContinuousScheduleBoundedReader | null,
  input: ContinuousScheduleBoundedReadInput | null,
): ContinuousScheduleReadState {
  const classId = input?.classId;
  const dateFrom = input?.dateFrom;
  const dateTo = input?.dateTo;
  const refreshKey = input?.refreshKey;
  const scope = JSON.stringify([classId, dateFrom, dateTo, refreshKey]);
  const [snapshot, setSnapshot] = useState<{
    reader: ContinuousScheduleBoundedReader | null;
    scope: string;
    state: ContinuousScheduleReadState;
  } | null>(null);

  useEffect(() => {
    if (!reader || !classId || !dateFrom || !dateTo) return undefined;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      const publish = (state: ContinuousScheduleReadState) => setSnapshot({ reader, scope, state });
      publish({ status: "loading" });
      try {
        const value = await reader.load({ classId, dateFrom, dateTo });
        if (active) publish({ status: "ready", value });
      } catch (error) {
        if (active) publish({ status: "ready", value: { source: "error", error } });
      }
    });
    return () => {
      active = false;
      reader.reset();
    };
  }, [classId, dateFrom, dateTo, reader, scope]);

  if (!reader || !classId || !dateFrom || !dateTo) return { status: "idle" };
  // An input/actor change renders before effect cleanup. Never lend the old
  // response to that new owner, month, or refresh attempt during that render.
  return snapshot?.reader === reader && snapshot.scope === scope
    ? snapshot.state : { status: "loading" };
}
