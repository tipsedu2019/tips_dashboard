const DAY_INDEX = new Map([
  ["일", 0],
  ["월", 1],
  ["화", 2],
  ["수", 3],
  ["목", 4],
  ["금", 5],
  ["토", 6],
]);

const SCHEDULE_STATES = new Set([
  "active",
  "exception",
  "makeup",
  "tbd",
  "skipped",
]);

const ISSUE_ORDER = [
  "missing_class_id",
  "unparseable_default_schedule",
  "missing_session_key",
  "duplicate_session_key",
  "missing_session_date",
  "invalid_session_state",
] as const;

const LEGACY_BILLING_COLORS_BY_MONTH = [
  "#805ad5",
  "#38a169",
  "#dd6b20",
  "#3182f6",
  "#d53f8c",
  "#319795",
  "#805ad5",
  "#38a169",
  "#dd6b20",
  "#3182f6",
  "#d53f8c",
  "#319795",
] as const;

type IssueOrderCode = (typeof ISSUE_ORDER)[number];

export type ContinuousScheduleSlotSeed = {
  classId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacherCatalogId: null;
  teacherName: string;
  classroomCatalogId: null;
  classroomName: string;
  sortOrder: number;
};

export type ContinuousLessonSessionSeed = {
  classId: string;
  sessionKey: string;
  sessionDate: string;
  scheduleState: "active" | "exception" | "makeup" | "tbd" | "skipped";
  startTime: null;
  endTime: null;
  teacherCatalogId: null;
  teacherNameSnapshot: "";
  classroomCatalogId: null;
  classroomNameSnapshot: "";
  memo: string;
  origin: "legacy";
  legacyBillingId: string;
  legacyBillingLabel: string;
  legacyBillingColor: string;
};

export type ContinuousScheduleLegacyInput = {
  classId: string;
  scheduleText: string;
  defaultSlots: Array<{
    day: string;
    startTime: string;
    endTime: string;
    teacher: string;
    classroom: string;
  }>;
  schedulePlan: unknown;
};

export type ContinuousScheduleBackfillIssueCode = IssueOrderCode;

export type ContinuousScheduleBackfillPreview = {
  classId: string;
  eligible: boolean;
  projectionHash?: string;
  slots: ContinuousScheduleSlotSeed[];
  sessions: ContinuousLessonSessionSeed[];
  issues: Array<{
    code: ContinuousScheduleBackfillIssueCode;
    sessionKey: string;
  }>;
  counts: {
    slots: number;
    sessions: number;
    issues: number;
  };
};

export type ContinuousScheduleShadowRows = {
  slots: unknown[];
  sessions: unknown[];
  projectionHash?: string;
};

export type ContinuousScheduleShadowIssueCode =
  | "slot_count_mismatch"
  | "session_count_mismatch"
  | "missing_shadow_session"
  | "unexpected_shadow_session"
  | "session_date_mismatch"
  | "session_state_mismatch"
  | "session_time_mismatch"
  | "session_teacher_mismatch"
  | "session_classroom_mismatch"
  | "session_memo_mismatch"
  | "projection_mismatch";

export type ContinuousScheduleShadowComparison = {
  matches: boolean;
  issueCodes: ContinuousScheduleShadowIssueCode[];
};

type OrderedIssue = {
  code: ContinuousScheduleBackfillIssueCode;
  sessionKey: string;
  inputOrder: number;
};

type UnknownRecord = Record<string, unknown>;

export type ContinuousScheduleSlotDiffIssue = {
  code:
    | "invalid_slot_id"
    | "slot_not_owned"
    | "duplicate_slot_id"
    | "invalid_weekday"
    | "invalid_time"
    | "invalid_sort_order"
    | "duplicate_slot_time";
  index: number;
};

export type ContinuousScheduleSlotDiffInput = {
  classId: string;
  existingSlots: Array<{
    id: string;
    classId: string;
    weekday: number;
    startTime: string;
    endTime: string;
    teacherCatalogId: string | null;
    classroomCatalogId: string | null;
    sortOrder: number;
  }>;
  slots: Array<{
    id: string | null;
    weekday: number;
    startTime: string;
    endTime: string;
    teacherCatalogId: string | null;
    classroomCatalogId: string | null;
    sortOrder: number;
  }>;
};

export type ContinuousScheduleSlotDiff = {
  inserts: ContinuousScheduleSlotDiffInput["slots"];
  updates: Array<ContinuousScheduleSlotDiffInput["slots"][number] & { id: string }>;
  deletes: string[];
};

export type ContinuousScheduleSlotDiffResult =
  | { ok: true; issues: []; diff: ContinuousScheduleSlotDiff }
  | { ok: false; issues: ContinuousScheduleSlotDiffIssue[]; diff: ContinuousScheduleSlotDiff };

export type ContinuousLessonSessionGenerationCandidate = {
  sessionKey: string;
  sessionDate: string;
  sourceScheduleSlotId: string;
  status: "creatable" | "existing";
  snapshot: null | {
    startTime: string;
    endTime: string;
    teacherCatalogId: string | null;
    teacherNameSnapshot: string;
    classroomCatalogId: string | null;
    classroomNameSnapshot: string;
    legacyBillingId: string;
    legacyBillingLabel: string;
    legacyBillingColor: string;
  };
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function sessionRecords(schedulePlan: unknown): UnknownRecord[] {
  const plan = record(schedulePlan);
  return Array.isArray(plan?.sessions)
    ? plan.sessions.flatMap((session) => {
        const normalized = record(session);
        return normalized ? [normalized] : [];
      })
    : [];
}

function isValidTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function issueOrder(code: ContinuousScheduleBackfillIssueCode): number {
  return ISSUE_ORDER.indexOf(code);
}

function shadowText(row: unknown, field: string): string {
  return text(record(row)?.[field]);
}

function optionalTime(value: unknown): string | null {
  const normalized = text(value);
  if (!normalized) return null;
  return /^\d{2}:\d{2}:\d{2}$/.test(normalized)
    ? normalized.slice(0, 5)
    : normalized;
}

function optionalText(value: unknown): string {
  return text(value);
}

function optionalId(value: unknown): string | null {
  const normalized = text(value);
  return normalized || null;
}

function slotComparable(slot: ContinuousScheduleSlotDiffInput["slots"][number]) {
  return [
    slot.weekday,
    slot.startTime,
    slot.endTime,
    slot.teacherCatalogId,
    slot.classroomCatalogId,
    slot.sortOrder,
  ];
}

function sameArray(left: unknown[], right: unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function dayAfter(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function weekdayFor(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

function legacyBillingFor(date: string) {
  const [year, month] = date.split("-").map(Number);
  return {
    legacyBillingId: `period:${year}-${String(month).padStart(2, "0")}`,
    legacyBillingLabel: `${year}년 ${month}월`,
    legacyBillingColor: LEGACY_BILLING_COLORS_BY_MONTH[month - 1],
  };
}

export function buildContinuousScheduleBackfillPreview(
  input: ContinuousScheduleLegacyInput,
): ContinuousScheduleBackfillPreview {
  const classId = text(input.classId);
  const issues: OrderedIssue[] = [];

  if (!classId) {
    issues.push({ code: "missing_class_id", sessionKey: "", inputOrder: -1 });
  }

  const slots = input.defaultSlots.flatMap((slot, sortOrder) => {
    const weekday = DAY_INDEX.get(text(slot.day));
    const startTime = text(slot.startTime);
    const endTime = text(slot.endTime);

    if (
      weekday === undefined ||
      !isValidTime(startTime) ||
      !isValidTime(endTime) ||
      startTime >= endTime
    ) {
      return [];
    }

    return [{
      classId,
      weekday,
      startTime,
      endTime,
      teacherCatalogId: null,
      teacherName: text(slot.teacher),
      classroomCatalogId: null,
      classroomName: text(slot.classroom),
      sortOrder,
    }];
  });

  if (text(input.scheduleText) && slots.length === 0) {
    issues.push({
      code: "unparseable_default_schedule",
      sessionKey: "",
      inputOrder: -1,
    });
  }

  const seenKeys = new Set<string>();
  const sessions = sessionRecords(input.schedulePlan).map((session, inputOrder) => {
    const sessionKey = text(session.id || session.sessionId || session.session_id);
    const sessionDate = text(session.date || session.dateValue || session.date_value);
    const stateText = text(
      session.scheduleState || session.schedule_state || session.state,
    );
    const scheduleState = stateText || "active";

    if (!sessionKey) {
      issues.push({ code: "missing_session_key", sessionKey, inputOrder });
    } else if (seenKeys.has(sessionKey)) {
      issues.push({ code: "duplicate_session_key", sessionKey, inputOrder });
    }
    seenKeys.add(sessionKey);

    if (!sessionDate) {
      issues.push({ code: "missing_session_date", sessionKey, inputOrder });
    }
    if (!SCHEDULE_STATES.has(scheduleState)) {
      issues.push({ code: "invalid_session_state", sessionKey, inputOrder });
    }

    return {
      classId,
      sessionKey,
      sessionDate,
      scheduleState: (SCHEDULE_STATES.has(scheduleState)
        ? scheduleState
        : "active") as ContinuousLessonSessionSeed["scheduleState"],
      startTime: null,
      endTime: null,
      teacherCatalogId: null,
      teacherNameSnapshot: "" as const,
      classroomCatalogId: null,
      classroomNameSnapshot: "" as const,
      memo: text(session.memo),
      origin: "legacy" as const,
      legacyBillingId: text(session.billingId || session.billing_id),
      legacyBillingLabel: text(session.billingLabel || session.billing_label),
      legacyBillingColor: text(session.billingColor || session.billing_color),
    };
  });

  const normalizedIssues = issues
    .sort(
      (left, right) =>
        left.inputOrder - right.inputOrder ||
        issueOrder(left.code) - issueOrder(right.code),
    )
    .map(({ code, sessionKey }) => ({ code, sessionKey }));

  return {
    classId,
    eligible: normalizedIssues.length === 0,
    slots,
    sessions,
    issues: normalizedIssues,
    counts: {
      slots: slots.length,
      sessions: sessions.length,
      issues: normalizedIssues.length,
    },
  };
}

export function diffContinuousScheduleSlots(
  input: ContinuousScheduleSlotDiffInput,
): ContinuousScheduleSlotDiffResult {
  const issues: ContinuousScheduleSlotDiffIssue[] = [];
  const existingById = new Map(input.existingSlots.map((slot) => [slot.id, slot]));
  const seenIds = new Set<string>();
  const timeIndexes = new Map<string, number[]>();

  input.slots.forEach((slot, index) => {
    if (slot.id !== null) {
      if (!slot.id.trim()) issues.push({ code: "invalid_slot_id", index });
      else if (seenIds.has(slot.id)) issues.push({ code: "duplicate_slot_id", index });
      else if (existingById.get(slot.id)?.classId !== input.classId) {
        issues.push({ code: "slot_not_owned", index });
      }
      seenIds.add(slot.id);
    }
    if (!Number.isInteger(slot.weekday) || slot.weekday < 0 || slot.weekday > 6) {
      issues.push({ code: "invalid_weekday", index });
    }
    if (!isValidTime(slot.startTime) || !isValidTime(slot.endTime) || slot.startTime >= slot.endTime) {
      issues.push({ code: "invalid_time", index });
    }
    if (!Number.isInteger(slot.sortOrder) || slot.sortOrder < 0) {
      issues.push({ code: "invalid_sort_order", index });
    }
    const key = `${slot.weekday}:${slot.startTime}:${slot.endTime}`;
    timeIndexes.set(key, [...(timeIndexes.get(key) || []), index]);
  });

  for (const indexes of timeIndexes.values()) {
    if (indexes.length > 1) {
      indexes.forEach((index) => issues.push({ code: "duplicate_slot_time", index }));
    }
  }

  if (issues.length > 0) {
    return {
      ok: false,
      issues: issues.sort((left, right) => left.index - right.index || left.code.localeCompare(right.code)),
      diff: { inserts: [], updates: [], deletes: [] },
    };
  }

  const inserts = input.slots.filter((slot) => slot.id === null);
  const updates = input.slots.flatMap((slot) => {
    if (slot.id === null) return [];
    const existing = existingById.get(slot.id)!;
    return sameArray(slotComparable(slot), slotComparable(existing)) ? [] : [{ ...slot, id: slot.id }];
  });
  const deletes = input.existingSlots
    .filter((slot) => slot.classId === input.classId && !seenIds.has(slot.id))
    .map((slot) => slot.id);

  return { ok: true, issues: [], diff: { inserts, updates, deletes } };
}

export function buildContinuousLessonSessionGenerationCandidates(input: {
  classId: string;
  dateFrom: string;
  dateTo: string;
  slots: Array<{
    id: string;
    weekday: number;
    startTime: string;
    endTime: string;
    teacherCatalogId: string | null;
    teacherName: string;
    classroomCatalogId: string | null;
    classroomName: string;
    sortOrder: number;
  }>;
  existingSessionKeys: ReadonlySet<string>;
}): {
  candidates: ContinuousLessonSessionGenerationCandidate[];
  counts: { requested: number; creatable: number; existing: number; excluded: number };
} {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(input.dateTo) || input.dateFrom > input.dateTo) {
    throw new Error("A valid inclusive generation date range is required.");
  }

  const candidates: ContinuousLessonSessionGenerationCandidate[] = [];
  for (let date = input.dateFrom; date <= input.dateTo; date = dayAfter(date)) {
    for (const slot of input.slots) {
      if (slot.weekday !== weekdayFor(date)) continue;
      const sessionKey = `default:${slot.id}:${date}`;
      if (input.existingSessionKeys.has(sessionKey)) {
        candidates.push({
          sessionKey,
          sessionDate: date,
          sourceScheduleSlotId: slot.id,
          status: "existing",
          snapshot: null,
        });
        continue;
      }
      candidates.push({
        sessionKey,
        sessionDate: date,
        sourceScheduleSlotId: slot.id,
        status: "creatable",
        snapshot: {
          startTime: slot.startTime,
          endTime: slot.endTime,
          teacherCatalogId: slot.teacherCatalogId,
          teacherNameSnapshot: slot.teacherName,
          classroomCatalogId: slot.classroomCatalogId,
          classroomNameSnapshot: slot.classroomName,
          ...legacyBillingFor(date),
        },
      });
    }
  }

  const existing = candidates.filter((candidate) => candidate.status === "existing").length;
  return {
    candidates,
    counts: {
      requested: candidates.length,
      creatable: candidates.length - existing,
      existing,
      excluded: 0,
    },
  };
}

export function compareContinuousScheduleShadow(
  preview: ContinuousScheduleBackfillPreview,
  shadow: ContinuousScheduleShadowRows,
): ContinuousScheduleShadowComparison {
  const issueCodes = new Set<ContinuousScheduleShadowIssueCode>();

  if (preview.slots.length !== shadow.slots.length) {
    issueCodes.add("slot_count_mismatch");
  }
  if (preview.sessions.length !== shadow.sessions.length) {
    issueCodes.add("session_count_mismatch");
  }

  const expectedByKey = new Map(
    preview.sessions.map((session) => [session.sessionKey, session]),
  );
  const shadowByKey = new Map(
    shadow.sessions.map((session) => [shadowText(session, "session_key"), session]),
  );

  for (const [sessionKey, session] of expectedByKey) {
    const shadowSession = shadowByKey.get(sessionKey);
    if (!shadowSession) {
      issueCodes.add("missing_shadow_session");
      continue;
    }
    if (session.sessionDate !== shadowText(shadowSession, "session_date")) {
      issueCodes.add("session_date_mismatch");
    }
    if (session.scheduleState !== shadowText(shadowSession, "schedule_state")) {
      issueCodes.add("session_state_mismatch");
    }
    if (
      session.startTime !== optionalTime(record(shadowSession)?.start_time)
      || session.endTime !== optionalTime(record(shadowSession)?.end_time)
    ) {
      issueCodes.add("session_time_mismatch");
    }
    if (
      session.teacherCatalogId !== optionalId(record(shadowSession)?.teacher_catalog_id)
      || session.teacherNameSnapshot !== optionalText(record(shadowSession)?.teacher_name_snapshot)
    ) {
      issueCodes.add("session_teacher_mismatch");
    }
    if (
      session.classroomCatalogId !== optionalId(record(shadowSession)?.classroom_catalog_id)
      || session.classroomNameSnapshot !== optionalText(record(shadowSession)?.classroom_name_snapshot)
    ) {
      issueCodes.add("session_classroom_mismatch");
    }
    if (session.memo !== optionalText(record(shadowSession)?.memo)) {
      issueCodes.add("session_memo_mismatch");
    }
  }

  for (const sessionKey of shadowByKey.keys()) {
    if (!expectedByKey.has(sessionKey)) {
      issueCodes.add("unexpected_shadow_session");
    }
  }

  const expectedProjectionHash = optionalText(preview.projectionHash);
  if (expectedProjectionHash && expectedProjectionHash !== optionalText(shadow.projectionHash)) {
    issueCodes.add("projection_mismatch");
  }

  const orderedCodes: ContinuousScheduleShadowIssueCode[] = [
    "slot_count_mismatch",
    "session_count_mismatch",
    "missing_shadow_session",
    "unexpected_shadow_session",
    "session_date_mismatch",
    "session_state_mismatch",
    "session_time_mismatch",
    "session_teacher_mismatch",
    "session_classroom_mismatch",
    "session_memo_mismatch",
    "projection_mismatch",
  ];
  const orderedIssueCodes = orderedCodes.filter((code) => issueCodes.has(code));

  return {
    matches: orderedIssueCodes.length === 0,
    issueCodes: orderedIssueCodes,
  };
}
