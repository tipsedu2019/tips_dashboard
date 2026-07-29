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
  const [state, setState] = useState<ContinuousScheduleReadState>({ status: "idle" });
  const classId = input?.classId;
  const dateFrom = input?.dateFrom;
  const dateTo = input?.dateTo;
  const refreshKey = input?.refreshKey;

  useEffect(() => {
    if (!reader || !classId || !dateFrom || !dateTo) return undefined;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setState({ status: "loading" });
      try {
        const value = await reader.load({ classId, dateFrom, dateTo });
        if (active) setState({ status: "ready", value });
      } catch (error) {
        if (active) setState({ status: "ready", value: { source: "error", error } });
      }
    });
    return () => {
      active = false;
      reader.reset();
    };
  }, [classId, dateFrom, dateTo, reader, refreshKey]);

  if (!reader || !classId || !dateFrom || !dateTo) return { status: "idle" };
  return state;
}
