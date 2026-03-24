import { parseSchedule } from "../data/sampleData.js";

export const SCHEDULE_PLAN_VERSION = 2;
export const DAY_OPTIONS = [
  { value: 1, label: "\uC6D4" },
  { value: 2, label: "\uD654" },
  { value: 3, label: "\uC218" },
  { value: 4, label: "\uBAA9" },
  { value: 5, label: "\uAE08" },
  { value: 6, label: "\uD1A0" },
  { value: 0, label: "\uC77C" },
];
export const SUBJECT_OPTIONS = ["\uC601\uC5B4", "\uC218\uD559"];
export const SESSION_COUNT_OPTIONS = Array.from(
  { length: 12 },
  (_, index) => index + 1,
);

const DAY_TO_INDEX = {
  "\uC77C": 0,
  "\uC6D4": 1,
  "\uD654": 2,
  "\uC218": 3,
  "\uBAA9": 4,
  "\uAE08": 5,
  "\uD1A0": 6,
};

const STATE_PRIORITY = {
  active: 0,
  force_active: 0,
  exception: 1,
  tbd: 2,
  makeup: 3,
};

const PERIOD_COLORS = [
  "#5c8f7d",
  "#8d73bc",
  "#758d58",
  "#a46f90",
  "#4f8e87",
  "#8b7a58",
];

const SESSION_PROGRESS_PRIORITY = {
  pending: 0,
  partial: 1,
  done: 2,
};

const DEFAULT_PLAN_RANGE = {
  rangeType: "custom",
  start: "",
  end: "",
  label: "",
  memo: "",
};

const DEFAULT_ACTUAL_RANGE = {
  status: "pending",
  rangeType: "custom",
  start: "",
  end: "",
  label: "",
  publicNote: "",
  teacherNote: "",
  updatedAt: "",
};

function createPlannerId() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `plan-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function clampMonth(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1 || number > 12) {
    return 1;
  }
  return number;
}

function clampSessionCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) {
    return 4;
  }
  return Math.min(Math.max(Math.round(number), 1), 12);
}

function getRecommendedSessionCount(selectedDays = []) {
  const weeklyCount = Math.max(uniqueSortedDays(selectedDays).length, 1);
  return clampSessionCount(weeklyCount * 4);
}

function uniqueSortedDays(days = []) {
  return [
    ...new Set(
      (days || [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6),
    ),
  ].sort((left, right) => {
    const leftIndex = DAY_OPTIONS.findIndex((item) => item.value === left);
    const rightIndex = DAY_OPTIONS.findIndex((item) => item.value === right);
    return leftIndex - rightIndex;
  });
}

export function parseDateValue(value) {
  if (
    !value ||
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

export function toDateString(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function getDateLabel(dateString) {
  const date = parseDateValue(dateString);
  if (!date) return dateString || "-";
  const dayLabel = [
    "\uC77C",
    "\uC6D4",
    "\uD654",
    "\uC218",
    "\uBAA9",
    "\uAE08",
    "\uD1A0",
  ][date.getDay()];
  return `${date.getMonth() + 1}/${date.getDate()} (${dayLabel})`;
}

function getDateTime(value) {
  const date = parseDateValue(value);
  return date ? date.getTime() : 0;
}

function normalizeSubject(subject) {
  const safeValue = String(subject || "").trim();
  if (!safeValue) {
    return SUBJECT_OPTIONS[0];
  }
  if (SUBJECT_OPTIONS.includes(safeValue)) {
    return safeValue;
  }
  return safeValue;
}

export function getFullClassName(subject, className) {
  const safeSubject = normalizeSubject(subject);
  const safeClassName = String(className || "").trim();
  if (!safeClassName) {
    return "";
  }
  return `[${safeSubject}] ${safeClassName}`;
}

export function deriveSelectedDaysFromSchedule(schedule) {
  const slots = parseSchedule(schedule || "");
  const indexes = slots
    .map((slot) => DAY_TO_INDEX[slot.day])
    .filter((value) => Number.isInteger(value));
  return uniqueSortedDays(indexes);
}

export function computeAutoEndDate(startDate, selectedDays, sessionCount) {
  const start = parseDateValue(startDate);
  const days = uniqueSortedDays(selectedDays);
  const targetCount = clampSessionCount(sessionCount);

  if (!start || days.length === 0 || targetCount < 1) {
    return "";
  }

  let cursor = new Date(start);
  let foundCount = 0;
  let protection = 0;

  while (foundCount < targetCount && protection < 366) {
    if (days.includes(cursor.getDay())) {
      foundCount += 1;
    }

    if (foundCount < targetCount) {
      cursor = addDays(cursor, 1);
    }
    protection += 1;
  }

  return toDateString(cursor);
}

export function getSuggestedNextStartDate(previousEndDate, selectedDays) {
  const previousDate = parseDateValue(previousEndDate);
  if (!previousDate) {
    return "";
  }

  const days = uniqueSortedDays(selectedDays);
  let cursor = addDays(previousDate, 1);
  let protection = 0;

  if (days.length === 0) {
    return toDateString(cursor);
  }

  while (!days.includes(cursor.getDay()) && protection < 14) {
    cursor = addDays(cursor, 1);
    protection += 1;
  }

  return toDateString(cursor);
}

function normalizeSessionStateEntry(entry) {
  if (!entry) {
    return null;
  }

  if (typeof entry === "string") {
    return {
      state: entry,
      memo: "",
      makeupDate: "",
    };
  }

  return {
    state: String(entry.state || "").trim() || "active",
    memo: String(entry.memo || "").trim(),
    makeupDate: String(entry.makeupDate || "").trim(),
  };
}

function normalizeSessionStates(states) {
  return Object.entries(states || {}).reduce((result, [dateString, value]) => {
    if (!parseDateValue(dateString)) {
      return result;
    }

    const normalized = normalizeSessionStateEntry(value);
    if (!normalized) {
      return result;
    }

    if (
      normalized.state === "active" &&
      !normalized.memo &&
      !normalized.makeupDate
    ) {
      return result;
    }

    result[dateString] = normalized;
    return result;
  }, {});
}

function buildSessionStateDraft(
  existing,
  { nextState, memo, makeupDate, isForced },
) {
  const current = existing || {
    state: isForced ? "force_active" : "active",
    memo: "",
    makeupDate: "",
  };
  const nextMemo = memo ?? current.memo ?? "";
  const nextMakeupDate = makeupDate ?? current.makeupDate ?? "";

  if (nextState === "active") {
    if (isForced) {
      return {
        state: "force_active",
        memo: nextMemo,
        makeupDate: "",
      };
    }

    if (!nextMemo && !nextMakeupDate) {
      return null;
    }

    return {
      state: "active",
      memo: nextMemo,
      makeupDate: "",
    };
  }

  return {
    state: nextState,
    memo: nextMemo,
    makeupDate: nextState === "exception" ? nextMakeupDate : "",
  };
}

function applySessionStateChange(planInput, dateString, options) {
  if (!parseDateValue(dateString)) {
    return planInput;
  }

  const current = planInput?.sessionStates?.[dateString];
  const nextStates = { ...(planInput?.sessionStates || {}) };
  const nextDraft = buildSessionStateDraft(current, options);

  if (!nextDraft) {
    delete nextStates[dateString];
  } else {
    nextStates[dateString] = nextDraft;
  }

  return {
    ...(planInput || {}),
    sessionStates: nextStates,
  };
}

export function applyCalendarDateToggle(planInput, dateString, meta = {}) {
  const currentState = planInput?.sessionStates?.[dateString]?.state || "";

  if (!currentState) {
    if (meta?.hasSession) {
      return applySessionStateChange(planInput, dateString, {
        nextState: "exception",
        isForced: false,
      });
    }

    return applySessionStateChange(planInput, dateString, {
      nextState: "active",
      isForced: true,
    });
  }

  if (currentState === "force_active") {
    return applySessionStateChange(planInput, dateString, {
      nextState: "makeup",
      memo: planInput?.sessionStates?.[dateString]?.memo || "",
      isForced: true,
    });
  }

  if (currentState === "makeup") {
    const nextStates = { ...(planInput?.sessionStates || {}) };
    delete nextStates[dateString];
    return {
      ...(planInput || {}),
      sessionStates: nextStates,
    };
  }

  if (currentState === "exception") {
    return applySessionStateChange(planInput, dateString, {
      nextState: "tbd",
      memo: planInput?.sessionStates?.[dateString]?.memo || "",
      isForced: false,
    });
  }

  if (currentState === "tbd") {
    return applySessionStateChange(planInput, dateString, {
      nextState: "active",
      memo: planInput?.sessionStates?.[dateString]?.memo || "",
      isForced: false,
    });
  }

  return applySessionStateChange(planInput, dateString, {
    nextState: "exception",
    memo: planInput?.sessionStates?.[dateString]?.memo || "",
    makeupDate: planInput?.sessionStates?.[dateString]?.makeupDate || "",
    isForced: false,
  });
}

export function applyCalendarDateSubstitution(planInput, sourceDate, targetDate) {
  if (!parseDateValue(sourceDate) || !parseDateValue(targetDate)) {
    return planInput;
  }

  return applySessionStateChange(planInput, sourceDate, {
    nextState: "exception",
    memo: planInput?.sessionStates?.[sourceDate]?.memo || "수업 대체",
    makeupDate: targetDate,
    isForced: false,
  });
}

export function getCalendarDaySurface(session, monthColor = "#216e4e") {
  const state = session?.state || "";

  if (!state) {
    return {
      isFilled: false,
      fillColor: "transparent",
      textColor: "#94a3b8",
      mutedTextColor: "#cbd5e1",
    };
  }

  let fillColor = monthColor || "#216e4e";
  if (state === "exception") {
    fillColor = "#dc2626";
  } else if (state === "tbd") {
    fillColor = "#d97706";
  } else if (state === "makeup") {
    fillColor = "#2563eb";
  }

  return {
    isFilled: true,
    fillColor,
    textColor: "#ffffff",
    mutedTextColor: "rgba(255, 255, 255, 0.82)",
  };
}

function extractMonth(dateString) {
  const date = parseDateValue(dateString);
  return date ? date.getMonth() + 1 : 1;
}

function createBillingPeriod(
  period = {},
  index = 0,
  selectedDays = [],
  sessionCount = 4,
) {
  const startDate = String(period.startDate || "").trim();
  const endDate = String(period.endDate || "").trim();
  const month = clampMonth(period.month || extractMonth(startDate));

  return {
    id: period.id || createPlannerId(),
    month,
    label: `${month}\uC6D4`,
    startDate,
    endDate:
      endDate || computeAutoEndDate(startDate, selectedDays, sessionCount),
    totalSessions: Number(period.totalSessions || 0),
    color: period.color || PERIOD_COLORS[index % PERIOD_COLORS.length],
  };
}

function createInitialBillingPeriods(
  rawPlan,
  defaults,
  selectedDays,
  globalSessionCount,
) {
  if (Array.isArray(rawPlan?.billingPeriods)) {
    if (rawPlan.billingPeriods.length === 0) {
      return [];
    }

    return rawPlan.billingPeriods.map((period, index) =>
      createBillingPeriod(period, index, selectedDays, globalSessionCount),
    );
  }

  const startDate = String(defaults.startDate || "").trim();
  const endDate = String(defaults.endDate || "").trim();

  return [
    createBillingPeriod(
      {
        month: extractMonth(startDate),
        startDate,
        endDate,
      },
      0,
      selectedDays,
      globalSessionCount,
    ),
  ];
}

function normalizeRangeType(value, fallback = "custom") {
  if (value === "pages" || value === "lessons" || value === "custom") {
    return value;
  }
  return fallback;
}

function normalizePlanRange(plan = {}) {
  return {
    rangeType: normalizeRangeType(plan.rangeType, DEFAULT_PLAN_RANGE.rangeType),
    start: String(plan.start || "").trim(),
    end: String(plan.end || "").trim(),
    label: String(plan.label || "").trim(),
    memo: String(plan.memo || "").trim(),
  };
}

function normalizeActualRange(actual = {}) {
  const status =
    actual.status === "done" || actual.status === "partial"
      ? actual.status
      : "pending";
  return {
    status,
    rangeType: normalizeRangeType(
      actual.rangeType,
      DEFAULT_ACTUAL_RANGE.rangeType,
    ),
    start: String(actual.start || "").trim(),
    end: String(actual.end || "").trim(),
    label: String(actual.label || "").trim(),
    publicNote: String(actual.publicNote || "").trim(),
    teacherNote: String(actual.teacherNote || "").trim(),
    updatedAt: String(actual.updatedAt || "").trim(),
  };
}

function normalizeTextbookCatalog(rawPlan, defaults = {}) {
  const rawTextbooks = Array.isArray(rawPlan?.textbooks)
    ? rawPlan.textbooks
    : [];
  const idsFromDefaults = Array.isArray(defaults.textbookIds)
    ? defaults.textbookIds
    : [];
  const rawCatalog = rawTextbooks
    .map((textbook, index) => ({
      textbookId: String(textbook?.textbookId || textbook?.id || "").trim(),
      order: Number.isFinite(Number(textbook?.order))
        ? Number(textbook.order)
        : index,
      role:
        textbook?.role === "supplement"
          ? "supplement"
          : index === 0
            ? "main"
            : "supplement",
      alias: String(textbook?.alias || "").trim(),
    }))
    .filter((textbook) => textbook.textbookId)
    .sort((left, right) => left.order - right.order);

  if (idsFromDefaults.length > 0) {
    const rawMap = new Map(
      rawCatalog.map((textbook) => [textbook.textbookId, textbook]),
    );
    return [
      ...new Set(
        idsFromDefaults
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    ].map((textbookId, index) => {
      const textbookMeta = (defaults.textbooks || []).find(
        (item) => String(item?.id || "") === textbookId,
      );
      const previous = rawMap.get(textbookId);
      return {
        textbookId,
        order: index,
        role:
          index === 0
            ? "main"
            : previous?.role === "supplement"
              ? "supplement"
              : "supplement",
        alias: previous?.alias || String(textbookMeta?.title || "").trim(),
      };
    });
  }

  return rawCatalog.map((textbook, index) => ({
    ...textbook,
    order: index,
    role:
      index === 0 && textbook.role !== "supplement" ? "main" : textbook.role,
  }));
}

function normalizeTextbookEntry(entry = {}, textbook, order) {
  return {
    textbookId: textbook.textbookId,
    order,
    role: textbook.role,
    plan: normalizePlanRange(entry.plan || entry),
    actual: normalizeActualRange(entry.actual || {}),
  };
}

function ensureTextbookEntries(textbooks = [], rawEntries = []) {
  const existingMap = new Map(
    (rawEntries || [])
      .map((entry) => {
        const textbookId = String(entry?.textbookId || "").trim();
        if (!textbookId) {
          return null;
        }
        return [textbookId, entry];
      })
      .filter(Boolean),
  );

  return textbooks.map((textbook, index) =>
    normalizeTextbookEntry(
      existingMap.get(textbook.textbookId),
      textbook,
      index,
    ),
  );
}

function getSourceDateForSession(session = {}) {
  return String(session.originalDate || session.date || "").trim();
}

function isCountedScheduleState(state) {
  return !["exception", "tbd"].includes(state);
}

function getProgressStatusFromEntries(textbookEntries = []) {
  const actualStatuses = (textbookEntries || [])
    .map((entry) => entry?.actual?.status || "pending")
    .filter(Boolean);

  if (
    actualStatuses.length === 0 ||
    actualStatuses.every((status) => status === "pending")
  ) {
    return "pending";
  }

  if (actualStatuses.every((status) => status === "done")) {
    return "done";
  }

  return "partial";
}

function normalizeExistingSession(session = {}, textbooks = []) {
  const scheduleState =
    String(session.scheduleState || session.state || "active").trim() ||
    "active";
  const textbookEntries = ensureTextbookEntries(
    textbooks,
    session.textbookEntries,
  );

  return {
    id: String(session.id || "").trim() || createPlannerId(),
    billingId: String(session.billingId || "").trim(),
    billingLabel: String(session.billingLabel || "").trim(),
    billingColor: String(session.billingColor || "").trim(),
    sessionNumber: Number.isFinite(Number(session.sessionNumber))
      ? Number(session.sessionNumber)
      : null,
    date: String(session.date || "").trim(),
    scheduleState,
    state: scheduleState,
    memo: String(session.memo || "").trim(),
    makeupDate: String(session.makeupDate || "").trim(),
    originalDate: String(session.originalDate || "").trim(),
    isForced: Boolean(session.isForced),
    progressStatus:
      session.progressStatus || getProgressStatusFromEntries(textbookEntries),
    publicNote: String(session.publicNote || "").trim(),
    teacherNote: String(session.teacherNote || "").trim(),
    textbookEntries,
  };
}

function buildExistingSessionMaps(rawSessions = [], textbooks = []) {
  const byId = new Map();
  const countedBySourceDate = new Map();
  const countedByBillingAndNumber = new Map();
  const rawByDate = new Map();

  (rawSessions || []).forEach((session) => {
    const normalized = normalizeExistingSession(session, textbooks);
    if (normalized.id) {
      byId.set(normalized.id, normalized);
    }

    const sourceDate = getSourceDateForSession(normalized);
    if (sourceDate && isCountedScheduleState(normalized.scheduleState)) {
      const queue = countedBySourceDate.get(sourceDate) || [];
      queue.push(normalized);
      countedBySourceDate.set(sourceDate, queue);
    }

    if (
      normalized.billingId &&
      normalized.sessionNumber &&
      isCountedScheduleState(normalized.scheduleState)
    ) {
      countedByBillingAndNumber.set(
        `${normalized.billingId}:${normalized.sessionNumber}`,
        normalized,
      );
    }

    if (normalized.date) {
      rawByDate.set(normalized.date, normalized);
    }
  });

  return {
    byId,
    countedBySourceDate,
    countedByBillingAndNumber,
    rawByDate,
  };
}

function takeSessionFromQueue(queueMap, key) {
  const queue = queueMap.get(key);
  if (!queue || queue.length === 0) {
    return null;
  }

  const match = queue.shift() || null;
  if (queue.length === 0) {
    queueMap.delete(key);
  }
  return match;
}

function cloneTextbookEntries(textbookEntries = [], textbooks = []) {
  return ensureTextbookEntries(textbooks, textbookEntries);
}

function createSessionPayload({
  source,
  countedSessions,
  existing,
  textbooks,
}) {
  const scheduleState = source.state;
  const textbookEntries = cloneTextbookEntries(
    existing?.textbookEntries,
    textbooks,
  );
  const progressStatus = getProgressStatusFromEntries(textbookEntries);

  return {
    id: existing?.id || createPlannerId(),
    billingId: source.billingId,
    billingLabel: source.billingLabel,
    billingColor: source.billingColor,
    date: source.date,
    scheduleState,
    state: scheduleState,
    memo: source.memo || existing?.memo || "",
    makeupDate: source.makeupDate || existing?.makeupDate || "",
    originalDate: source.originalDate || existing?.originalDate || "",
    isForced: Boolean(source.isForced),
    sessionNumber: countedSessions ? countedSessions : null,
    progressStatus,
    publicNote: existing?.publicNote || "",
    teacherNote: existing?.teacherNote || "",
    textbookEntries,
  };
}

function buildHistoryEntry(calculated) {
  const totalSessions = Array.isArray(calculated?.sessions)
    ? calculated.sessions.length
    : 0;
  const completedSessions = (calculated?.sessions || []).filter(
    (session) => session.progressStatus === "done",
  ).length;
  const totalTextbooks = Array.isArray(calculated?.textbooks)
    ? calculated.textbooks.length
    : 0;

  return {
    id: createPlannerId(),
    savedAt: new Date().toISOString(),
    summary: `${totalSessions}\uD68C\uCC28 / ${completedSessions}\uD68C \uC644\uB8CC / ${totalTextbooks}\uAD8C \uAD50\uC7AC`,
  };
}

function appendHistory(history = [], calculated) {
  const normalizedHistory = Array.isArray(history)
    ? history
        .map((entry) => ({
          id: String(entry?.id || "").trim() || createPlannerId(),
          savedAt: String(entry?.savedAt || "").trim(),
          summary: String(entry?.summary || "").trim(),
        }))
        .filter((entry) => entry.savedAt || entry.summary)
    : [];

  return [...normalizedHistory, buildHistoryEntry(calculated)].slice(-10);
}

export function normalizeSchedulePlan(rawPlan, defaults = {}) {
  const selectedDays = uniqueSortedDays(
    rawPlan?.selectedDays?.length
      ? rawPlan.selectedDays
      : deriveSelectedDaysFromSchedule(defaults.schedule || ""),
  );

  const globalSessionCount = clampSessionCount(
    rawPlan?.globalSessionCount ??
      defaults.globalSessionCount ??
      getRecommendedSessionCount(selectedDays),
  );
  const billingPeriods = createInitialBillingPeriods(
    rawPlan,
    defaults,
    selectedDays,
    globalSessionCount,
  );
  const sessionStates = normalizeSessionStates(rawPlan?.sessionStates);
  const textbooks = normalizeTextbookCatalog(rawPlan, defaults);

  const normalized = {
    version: SCHEDULE_PLAN_VERSION,
    subject: normalizeSubject(rawPlan?.subject || defaults.subject),
    className: String(rawPlan?.className || defaults.className || "").trim(),
    selectedDays,
    globalSessionCount,
    billingPeriods,
    sessionStates,
    textbooks,
    sessions: Array.isArray(rawPlan?.sessions) ? rawPlan.sessions : [],
    history: Array.isArray(rawPlan?.history) ? rawPlan.history : [],
    generatedAt: rawPlan?.generatedAt || null,
  };

  const calculated = calculateSchedulePlan(normalized);
  return {
    ...normalized,
    billingPeriods: calculated.billingPeriods,
    sessions: calculated.sessions,
  };
}

export function calculateSchedulePlan(planInput) {
  const safePlanInput = planInput || {};
  const selectedDays = uniqueSortedDays(safePlanInput.selectedDays);
  const globalSessionCount = clampSessionCount(
    safePlanInput.globalSessionCount,
  );
  const sessionStates = normalizeSessionStates(safePlanInput.sessionStates);
  const billingPeriods = (safePlanInput.billingPeriods || []).map(
    (period, index) =>
      createBillingPeriod(period, index, selectedDays, globalSessionCount),
  );
  const textbooks = normalizeTextbookCatalog(safePlanInput, safePlanInput);
  const existingMaps = buildExistingSessionMaps(
    safePlanInput.sessions,
    textbooks,
  );

  const overlapIds = new Set();
  const periodMeta = billingPeriods
    .map((period, index) => {
      const startDateObj = parseDateValue(period.startDate);
      const endDateObj = parseDateValue(period.endDate);
      return {
        ...period,
        index,
        startDateObj,
        endDateObj,
      };
    })
    .filter(
      (period) =>
        period.startDateObj &&
        period.endDateObj &&
        period.startDateObj <= period.endDateObj,
    );

  periodMeta.forEach((left, leftIndex) => {
    periodMeta.slice(leftIndex + 1).forEach((right) => {
      if (
        left.startDateObj <= right.endDateObj &&
        right.startDateObj <= left.endDateObj
      ) {
        overlapIds.add(left.id);
        overlapIds.add(right.id);
      }
    });
  });

  const editorEntriesByPeriod = {};
  const sessions = [];
  let minDate = null;
  let maxDate = null;

  periodMeta.forEach((period) => {
    const baseEntries = [];
    let cursor = new Date(period.startDateObj);
    let protection = 0;

    while (cursor <= period.endDateObj && protection < 370) {
      const dateString = toDateString(cursor);
      const override = sessionStates[dateString];
      const overrideState = override?.state || "";
      const hasBaseSession = selectedDays.includes(cursor.getDay());

      if (
        hasBaseSession ||
        overrideState === "force_active" ||
        overrideState === "makeup"
      ) {
        baseEntries.push({
          billingId: period.id,
          billingLabel: period.label,
          billingColor: period.color,
          date: dateString,
          dateObj: new Date(cursor),
          state:
            overrideState === "force_active" || !overrideState
              ? "active"
              : overrideState,
          rawState:
            overrideState || (hasBaseSession ? "active" : "force_active"),
          memo: override?.memo || "",
          makeupDate: override?.makeupDate || "",
          originalDate: "",
          isForced:
            overrideState === "force_active" || overrideState === "makeup",
        });

        if (overrideState === "exception" && override?.makeupDate) {
          const makeupDateObj = parseDateValue(override.makeupDate);
          if (makeupDateObj) {
            baseEntries.push({
              billingId: period.id,
              billingLabel: period.label,
              billingColor: period.color,
              date: toDateString(makeupDateObj),
              dateObj: makeupDateObj,
              state: "makeup",
              rawState: "makeup",
              memo: "",
              makeupDate: "",
              originalDate: dateString,
              isForced: false,
            });
          }
        }
      }

      cursor = addDays(cursor, 1);
      protection += 1;
    }

    baseEntries.sort((left, right) => {
      const diff = left.dateObj - right.dateObj;
      if (diff !== 0) return diff;
      return (
        (STATE_PRIORITY[left.rawState] || 0) -
        (STATE_PRIORITY[right.rawState] || 0)
      );
    });

    let countedSessions = 0;
    const editorEntries = [];

    baseEntries.forEach((entry) => {
      const countsTowardTotal = isCountedScheduleState(entry.state);
      if (countsTowardTotal) {
        countedSessions += 1;
      }

      const sourceDate = entry.originalDate || entry.date;
      let existing = null;

      if (countsTowardTotal && sourceDate) {
        existing = takeSessionFromQueue(
          existingMaps.countedBySourceDate,
          sourceDate,
        );
      }

      if (!existing && countsTowardTotal) {
        existing =
          existingMaps.countedByBillingAndNumber.get(
            `${entry.billingId}:${countedSessions}`,
          ) || null;
      }

      if (!existing && existingMaps.rawByDate.has(entry.date)) {
        existing = existingMaps.rawByDate.get(entry.date);
      }

      const session = createSessionPayload({
        source: entry,
        countedSessions: countsTowardTotal ? countedSessions : null,
        existing,
        textbooks,
      });

      sessions.push(session);

      if (!entry.originalDate) {
        editorEntries.push({
          ...session,
          rawState: entry.rawState,
          hasBaseSession: selectedDays.includes(entry.dateObj.getDay()),
        });
      }

      const currentDate = entry.dateObj;
      if (!minDate || currentDate < minDate) {
        minDate = currentDate;
      }
      if (!maxDate || currentDate > maxDate) {
        maxDate = currentDate;
      }
    });

    editorEntriesByPeriod[period.id] = editorEntries;
    period.totalSessions = countedSessions;
  });

  sessions.sort((left, right) => {
    const diff = getDateTime(left.date) - getDateTime(right.date);
    if (diff !== 0) return diff;
    return (
      (STATE_PRIORITY[left.scheduleState] || 0) -
      (STATE_PRIORITY[right.scheduleState] || 0)
    );
  });

  const months = [];
  if (minDate && maxDate) {
    let cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    const limit = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
    while (cursor <= limit) {
      months.push({ year: cursor.getFullYear(), month: cursor.getMonth() });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
  }

  return {
    billingPeriods,
    selectedDays,
    globalSessionCount,
    editorEntriesByPeriod,
    textbooks,
    sessions,
    months,
    overlapIds: [...overlapIds],
    hasRenderableData: sessions.length > 0,
    minDate,
    maxDate,
  };
}

export function buildSchedulePlanForSave(plan, defaults = {}) {
  const normalized = normalizeSchedulePlan(plan, defaults);
  const calculated = calculateSchedulePlan(normalized);

  const payload = {
    version: SCHEDULE_PLAN_VERSION,
    subject: normalizeSubject(defaults.subject || normalized.subject),
    className: String(defaults.className || normalized.className || "").trim(),
    selectedDays: normalized.selectedDays,
    globalSessionCount: normalized.globalSessionCount,
    billingPeriods: calculated.billingPeriods.map((period) => ({
      id: period.id,
      month: period.month,
      label: period.label,
      startDate: period.startDate,
      endDate: period.endDate,
      totalSessions: period.totalSessions,
      color: period.color,
    })),
    sessionStates: normalized.sessionStates,
    textbooks: calculated.textbooks.map((textbook, index) => ({
      textbookId: textbook.textbookId,
      order: index,
      role:
        textbook.role === "supplement"
          ? "supplement"
          : index === 0
            ? "main"
            : textbook.role,
      alias: textbook.alias || "",
    })),
    sessions: calculated.sessions.map((session) => ({
      id: session.id,
      billingId: session.billingId,
      billingLabel: session.billingLabel,
      billingColor: session.billingColor,
      sessionNumber: session.sessionNumber,
      date: session.date,
      scheduleState: session.scheduleState,
      state: session.scheduleState,
      memo: session.memo || "",
      makeupDate: session.makeupDate || "",
      originalDate: session.originalDate || "",
      isForced: Boolean(session.isForced),
      progressStatus:
        session.progressStatus ||
        getProgressStatusFromEntries(session.textbookEntries),
      publicNote: session.publicNote || "",
      teacherNote: session.teacherNote || "",
      textbookEntries: ensureTextbookEntries(
        calculated.textbooks,
        session.textbookEntries,
      ).map((entry) => ({
        textbookId: entry.textbookId,
        order: entry.order,
        role: entry.role,
        plan: normalizePlanRange(entry.plan || DEFAULT_PLAN_RANGE),
        actual: normalizeActualRange(entry.actual || DEFAULT_ACTUAL_RANGE),
      })),
    })),
    history: appendHistory(normalized.history, calculated),
    generatedAt: new Date().toISOString(),
  };

  return payload;
}

export function getStateBadgeLabel(state) {
  switch (state) {
    case "exception":
      return "\uD734\uAC15";
    case "tbd":
      return "\uBBF8\uC815";
    case "makeup":
      return "\uBCF4\uAC15";
    default:
      return "\uC815\uC0C1 \uC218\uC5C5";
  }
}

export function getStateTone(state) {
  switch (state) {
    case "exception":
      return {
        background: "rgba(239, 68, 68, 0.12)",
        color: "#b91c1c",
      };
    case "tbd":
      return {
        background: "rgba(245, 158, 11, 0.16)",
        color: "#b45309",
      };
    case "makeup":
      return {
        background: "rgba(16, 185, 129, 0.16)",
        color: "#047857",
      };
    default:
      return {
        background: "rgba(33, 110, 78, 0.12)",
        color: "var(--accent-color)",
      };
  }
}

export function formatPlannerDateLabel(dateString) {
  return getDateLabel(dateString);
}

export function getPeriodSummary(period) {
  const startLabel = period?.startDate || "-";
  const endLabel = period?.endDate || "-";
  return `${period?.label || "\uBBF8\uC815"} \u00B7 ${startLabel} ~ ${endLabel}`;
}

export function getProgressTone(progressStatus) {
  switch (progressStatus) {
    case "done":
      return {
        background: "rgba(37, 99, 235, 0.12)",
        color: "#1d4ed8",
      };
    case "partial":
      return {
        background: "rgba(245, 158, 11, 0.16)",
        color: "#b45309",
      };
    default:
      return {
        background: "rgba(148, 163, 184, 0.16)",
        color: "#475569",
      };
  }
}

export function getProgressBadgeLabel(progressStatus) {
  switch (progressStatus) {
    case "done":
      return "\uC644\uB8CC";
    case "partial":
      return "\uC9C4\uD589 \uC911";
    default:
      return "\uC608\uC815";
  }
}
