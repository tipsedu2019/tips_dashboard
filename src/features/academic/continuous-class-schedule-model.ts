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
};

export type ContinuousScheduleShadowIssueCode =
  | "slot_count_mismatch"
  | "session_count_mismatch"
  | "missing_shadow_session"
  | "unexpected_shadow_session"
  | "session_date_mismatch"
  | "session_state_mismatch";

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
      teacherNameSnapshot: "",
      classroomCatalogId: null,
      classroomNameSnapshot: "",
      origin: "legacy",
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
  }

  for (const sessionKey of shadowByKey.keys()) {
    if (!expectedByKey.has(sessionKey)) {
      issueCodes.add("unexpected_shadow_session");
    }
  }

  const orderedCodes: ContinuousScheduleShadowIssueCode[] = [
    "slot_count_mismatch",
    "session_count_mismatch",
    "missing_shadow_session",
    "unexpected_shadow_session",
    "session_date_mismatch",
    "session_state_mismatch",
  ];
  const orderedIssueCodes = orderedCodes.filter((code) => issueCodes.has(code));

  return {
    matches: orderedIssueCodes.length === 0,
    issueCodes: orderedIssueCodes,
  };
}
