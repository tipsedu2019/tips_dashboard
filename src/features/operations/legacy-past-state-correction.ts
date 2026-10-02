type Row = Record<string, unknown>;
export type LegacyPastState = "active" | "exception" | "skipped";
export type LegacyPastStateCorrectionTarget = {
  sessionId: string;
  date: string;
  currentState: LegacyPastState;
  raw: Row;
};

const record = (value: unknown): Row | null => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Row : null;
const validDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

// This route is selected from saved JSON, never the generated editor draft.
// It does not infer resources or recreate a historical row.
export function resolveLegacyPastStateCorrectionTarget(
  savedPlan: unknown,
  sessionId: string,
  today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date()),
): LegacyPastStateCorrectionTarget | null {
  const plan = record(savedPlan);
  if (!plan || !Array.isArray(plan.sessions) || !validDate(today) || !sessionId) return null;
  const sessions = plan.sessions.map(record).filter((row): row is Row => row !== null);
  const matches = sessions.filter(row => row.id === sessionId);
  if (matches.length !== 1) return null;
  const row = matches[0];
  if (typeof row.id !== "string" || row.id.trim() !== row.id || !row.id
    || !validDate(row.date) || row.date >= today
    || sessions.filter(candidate => candidate.date === row.date).length !== 1
    || row.isForced || row.originalDate || row.makeupDate) return null;
  if (row.scheduleState !== undefined && row.scheduleState !== null && typeof row.scheduleState !== "string") return null;
  const state = row.scheduleState || row.state || "active";
  if (!["active", "exception", "skipped"].includes(String(state))) return null;
  const minutes = (value: unknown) => {
    const match = typeof value === "string" ? value.match(/^(\d{1,2}):([0-5]\d)(?::00(?:\.0+)?)?$/) : null;
    return match && (Number(match[1]) < 24 || (Number(match[1]) === 24 && Number(match[2]) === 0))
      ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const start = minutes(row.startTime), end = minutes(row.endTime);
  if (start === null || end === null || start >= end
    || !["startTime", "endTime", "teacherCatalogId", "classroomCatalogId"].every(field => Object.prototype.hasOwnProperty.call(row, field))
    || typeof row.teacherCatalogId !== "string" || !row.teacherCatalogId
    || typeof row.classroomCatalogId !== "string" || !row.classroomCatalogId) return null;
  return { sessionId: row.id, date: row.date, currentState: state as LegacyPastState, raw: structuredClone(row) };
}

export type LegacyPastStateCorrectionInput = {
  classId: string;
  expectedPlan: Row;
  target: LegacyPastStateCorrectionTarget;
  state: "active" | "exception";
  reason: string;
};
export type LegacyPastStateCorrectionPreview = {
  kind: "past_lesson_state_correction";
  classId: string;
  lessonId: string;
  date: string;
  expectedState: LegacyPastState;
  state: "active" | "exception";
  planHash: string;
  reviewRequired: boolean;
  unknownOccupancyReviewHash: string;
  unknownOccupancyCount: number;
  warnings: { code: "unknown_occupancy"; count: number }[];
};

const inputError = (code: string) => ({ code });
function parameters(value: LegacyPastStateCorrectionInput): Row {
  const target = resolveLegacyPastStateCorrectionTarget(value.expectedPlan, value.target.sessionId);
  if (!value.classId || !target || target.date !== value.target.date || target.currentState !== value.target.currentState
    || !equal(target.raw, value.target.raw) || !["active", "exception"].includes(value.state)
    || value.state === target.currentState || !value.reason.trim() || value.reason.trim().length > 300) throw inputError("past_state_correction_invalid");
  return { p_class_id: value.classId, p_expected_schedule_plan: structuredClone(value.expectedPlan),
    p_lesson_id: target.sessionId, p_session_date: target.date, p_expected_state: target.currentState,
    p_schedule_state: value.state, p_reason: value.reason.trim() };
}

function parsePreview(data: unknown, value: LegacyPastStateCorrectionInput, committed = false): LegacyPastStateCorrectionPreview {
  const row = record(data), warnings = row?.warnings;
  const count = row?.unknownOccupancyCount;
  const hash = /^[a-f0-9]{64}$/i;
  if (!row || row.kind !== "past_lesson_state_correction" || row.classId !== value.classId
    || row.lessonId !== value.target.sessionId || row.date !== value.target.date
    || row.expectedState !== value.target.currentState || row.state !== value.state
    || typeof row.planHash !== "string" || !hash.test(row.planHash)
    || typeof row.unknownOccupancyReviewHash !== "string" || !hash.test(row.unknownOccupancyReviewHash)
    || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0
    || row.reviewRequired !== (!committed && count > 0) || !Array.isArray(warnings)
    || (count === 0 ? warnings.length !== 0 : warnings.length !== 1
      || record(warnings[0])?.code !== "unknown_occupancy" || record(warnings[0])?.count !== count)) {
    throw inputError("past_state_correction_response_invalid");
  }
  return row as LegacyPastStateCorrectionPreview;
}

export function createLegacyPastStateCorrectionAction(input: {
  rpc: (name: string, parameters: Row) => Promise<{ data: unknown; error: unknown }>;
  createRequestKey?: () => string;
}) {
  const reviewed = new WeakMap<LegacyPastStateCorrectionPreview, string>();
  const requestKeys = new Map<string, string>();
  const request = async (name: string, args: Row) => {
    const result = await input.rpc(name, args);
    if (result.error) throw result.error;
    return result.data;
  };
  return {
    async preview(value: LegacyPastStateCorrectionInput) {
      const args = parameters(value);
      const result = parsePreview(await request("preview_past_lesson_state_correction_v1", {
        ...args, p_unknown_occupancy_review_hash: null, p_acknowledge_unknown_occupancy: false,
      }), value);
      reviewed.set(result, JSON.stringify(ordered(args)));
      return result;
    },
    async save(value: LegacyPastStateCorrectionInput, preview: LegacyPastStateCorrectionPreview, acknowledge: boolean) {
      const args = parameters(value);
      if (reviewed.get(preview) !== JSON.stringify(ordered(args))) throw inputError("past_state_correction_review_stale");
      if (preview.reviewRequired && !acknowledge) throw inputError("past_state_correction_review_required");
      const commit = { ...args, p_unknown_occupancy_review_hash: preview.unknownOccupancyReviewHash,
        // Calling save is the explicit final confirmation. Unknown warnings
        // additionally require the separately checked acknowledgement above.
        p_acknowledge_unknown_occupancy: true };
      const body = JSON.stringify(ordered(commit));
      if (!requestKeys.has(body)) requestKeys.set(body, (input.createRequestKey || (() => crypto.randomUUID()))());
      const requestKey = requestKeys.get(body)!;
      const data = await request("save_past_lesson_state_correction_v1", { ...commit, p_request_key: requestKey });
      const result = parsePreview(data, value, true), row = record(data)!;
      if (row.outcome !== "applied" || row.requestKey !== requestKey || record(row.notifications)?.state !== "not_requested") {
        throw inputError("past_state_correction_response_invalid");
      }
      return result;
    },
  };
}

export function legacyPastStateCorrectionErrorMessage(error: unknown, saving = false): string {
  const code = error instanceof Error ? "" : record(error)?.code;
  const message = error instanceof Error ? "" : record(error)?.message;
  if (code === "23P01") return "겹치는 일정이 확인되어 정정할 수 없습니다. 일정 정보를 확인해 주세요.";
  if (code === "42501") return "과거 상태 정정은 관리자만 사용할 수 있습니다.";
  if (code === "past_state_correction_review_stale" || (code === "P0001"
    && ["agent_stale", "agent_review_stale", "class_schedule_stale"].includes(String(message)))) return "일정 정보가 바뀌었습니다. 해당 회차를 다시 불러온 뒤 확인해 주세요.";
  if (code === "past_state_correction_review_required") return "확인이 필요한 일정 경고를 확인해 주세요.";
  if (code === "P0001" && message === "agent_approval_workflow_required") return "휴보강 승인 절차를 먼저 확인해 주세요.";
  if (code === "past_state_correction_invalid" || (code === "22023"
    && ["agent_invalid", "agent_no_change", "agent_timing_required"].includes(String(message)))) return "정정 상태와 사유를 확인해 주세요.";
  return saving ? "정정 결과를 확인하지 못했습니다. 중복 정정을 피하려면 해당 회차를 다시 불러와 확인해 주세요."
    : "정정 내용을 확인하지 못했습니다. 다시 확인해 주세요.";
}

const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered)
  : record(value) ? Object.fromEntries(Object.entries(value as Row).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, ordered(item)])) : value;
const equal = (left: unknown, right: unknown) => JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
const omit = (row: Row, fields: string[]) => Object.fromEntries(Object.entries(row).filter(([field]) => !fields.includes(field)));

// An ordinary failed save may leave just this state edit in the generated draft.
// All scheduling fields still have to match the accepted normalized baseline.
export function resolveLegacyPastStateCorrectionDraft(
  baselineValue: unknown, draftValue: unknown, target: LegacyPastStateCorrectionTarget,
): { dirty: boolean; state: "active" | "exception" } | null {
  const baseline = record(baselineValue), draft = record(draftValue);
  if (!baseline || !draft || !Array.isArray(baseline.sessions) || !Array.isArray(draft.sessions)) return null;
  const before = baseline.sessions.map(record), after = draft.sessions.map(record);
  if (before.some(row => !row) || after.some(row => !row)) return null;
  const selectedBefore = before.filter(row => row?.id === target.sessionId);
  const selectedAfter = after.filter(row => row?.id === target.sessionId);
  if (selectedBefore.length !== 1 || selectedAfter.length !== 1
    || selectedBefore[0]?.date !== target.date || selectedAfter[0]?.date !== target.date
    || (selectedBefore[0]?.scheduleState || selectedBefore[0]?.state || "active") !== target.currentState) return null;
  const state = selectedAfter[0]?.scheduleState || selectedAfter[0]?.state || "active";
  const dirty = !equal(baseline, draft);
  if (!dirty) return { dirty: false, state: target.currentState === "active" ? "exception" : "active" };
  if (state !== "active" && state !== "exception") return null;
  if (state === target.currentState) return null;
  const scheduleShape = (plan: Row) => {
    const sessionStates = { ...(record(plan.sessionStates) || {}) };
    const entry = record(sessionStates[target.date]) || {};
    sessionStates[target.date] = { memo: entry.memo || "", makeupMemo: entry.makeupMemo || "", makeupDate: entry.makeupDate || "" };
    return { ...omit(plan, ["generatedAt", "history", "sessions", "billingPeriods", "sessionStates"]), sessionStates,
      billingPeriods: Array.isArray(plan.billingPeriods) ? plan.billingPeriods.map(value => {
        const period = record(value); return period ? omit(period, ["totalSessions"]) : value;
      }) : plan.billingPeriods,
      sessions: (plan.sessions as Row[]).map(row => omit(row,
        row.id === target.sessionId ? ["sessionNumber", "state", "scheduleState"] : ["sessionNumber"])) };
  };
  return equal(scheduleShape(baseline), scheduleShape(draft)) ? { dirty: true, state } : null;
}
