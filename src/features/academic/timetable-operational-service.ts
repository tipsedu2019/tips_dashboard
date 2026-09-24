type Input = { classId: string; patch: Record<string, unknown>; expectedSchedulePlan?: Record<string, unknown> | null };
type Dependencies = {
  requestKey: string;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  refresh?: () => Promise<unknown>;
};
/** Retain this action for retries of the same submitted input. */
export function createTimetableOperationalMutation({ requestKey, rpc, refresh }: Dependencies) {
  return {
    requestKey,
    async save(input: Input) {
      const { data, error } = await rpc("update_class_operational_v1", {
        p_class_id: input.classId,
        p_patch: input.patch,
        p_request_key: requestKey,
        p_expected_schedule_plan: input.expectedSchedulePlan ?? null,
      });
      if (error) throw error;
      try {
        const receipt = await refresh?.();
        return { data, refreshStatus: (receipt as { status?: string } | undefined)?.status === "pending" ? "pending" as const : "complete" as const };
      } catch {
        return { data, refreshStatus: "pending" as const };
      }
    },
  };
}

export function timetableOperationalErrorMessage(error: unknown, fallback: string): string {
  const value = error as { code?: string; message?: string } | null;
  if (value?.code === "23P01" && value.message === "timetable_resource_conflict") {
    return "같은 선생님 또는 강의실의 일정이 겹치거나 확인이 필요한 일정이 있습니다. 입력을 확인해 주세요.";
  }
  if (value?.message === "class_schedule_stale" || value?.message === "timetable_stale") {
    return "운영 일정이 변경되었습니다. 입력을 유지한 채 최신 일정을 다시 불러와 주세요.";
  }
  return fallback;
}
