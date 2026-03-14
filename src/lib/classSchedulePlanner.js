import { parseSchedule } from '../data/sampleData';

export const SCHEDULE_PLAN_VERSION = 1;
export const DAY_OPTIONS = [
  { value: 1, label: '월' },
  { value: 2, label: '화' },
  { value: 3, label: '수' },
  { value: 4, label: '목' },
  { value: 5, label: '금' },
  { value: 6, label: '토' },
  { value: 0, label: '일' },
];
export const SUBJECT_OPTIONS = ['영어', '수학'];
export const SESSION_COUNT_OPTIONS = Array.from({ length: 12 }, (_, index) => index + 1);

const DAY_TO_INDEX = {
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
};

const STATE_PRIORITY = {
  active: 0,
  force_active: 0,
  exception: 1,
  tbd: 2,
  makeup: 3,
};

const PERIOD_COLORS = [
  '#216e4e',
  '#d97706',
  '#2563eb',
  '#9333ea',
  '#e11d48',
  '#ca8a04',
];

function createPlannerId() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
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
  return [...new Set((days || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))]
    .sort((left, right) => {
      const leftIndex = DAY_OPTIONS.findIndex((item) => item.value === left);
      const rightIndex = DAY_OPTIONS.findIndex((item) => item.value === right);
      return leftIndex - rightIndex;
    });
}

export function parseDateValue(value) {
  if (!value || typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
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
    return '';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function getDateLabel(dateString) {
  const date = parseDateValue(dateString);
  if (!date) return dateString || '-';
  const dayLabel = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
  return `${date.getMonth() + 1}/${date.getDate()} (${dayLabel})`;
}

function getDateTime(value) {
  const date = parseDateValue(value);
  return date ? date.getTime() : 0;
}

function normalizeSubject(subject) {
  const safeValue = String(subject || '').trim();
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
  const safeClassName = String(className || '').trim();
  if (!safeClassName) {
    return '';
  }
  return `[${safeSubject}] ${safeClassName}`;
}

export function deriveSelectedDaysFromSchedule(schedule) {
  const slots = parseSchedule(schedule || '');
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
    return '';
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
    return '';
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

  if (typeof entry === 'string') {
    return {
      state: entry,
      memo: '',
      makeupDate: '',
    };
  }

  return {
    state: String(entry.state || '').trim() || 'active',
    memo: String(entry.memo || '').trim(),
    makeupDate: String(entry.makeupDate || '').trim(),
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

    if (normalized.state === 'active' && !normalized.memo && !normalized.makeupDate) {
      return result;
    }

    result[dateString] = normalized;
    return result;
  }, {});
}

function extractMonth(dateString) {
  const date = parseDateValue(dateString);
  return date ? date.getMonth() + 1 : 1;
}

function createBillingPeriod(period = {}, index = 0, selectedDays = [], sessionCount = 4) {
  const startDate = String(period.startDate || '').trim();
  const endDate = String(period.endDate || '').trim();
  const month = clampMonth(period.month || extractMonth(startDate));

  return {
    id: period.id || createPlannerId(),
    month,
    label: `${month}월`,
    startDate,
    endDate: endDate || computeAutoEndDate(startDate, selectedDays, sessionCount),
    totalSessions: Number(period.totalSessions || 0),
    color: period.color || PERIOD_COLORS[index % PERIOD_COLORS.length],
  };
}

function createInitialBillingPeriods(rawPlan, defaults, selectedDays, globalSessionCount) {
  if (Array.isArray(rawPlan?.billingPeriods) && rawPlan.billingPeriods.length > 0) {
    return rawPlan.billingPeriods.map((period, index) => createBillingPeriod(period, index, selectedDays, globalSessionCount));
  }

  const startDate = String(defaults.startDate || '').trim();
  const endDate = String(defaults.endDate || '').trim();

  return [
    createBillingPeriod({
      month: extractMonth(startDate),
      startDate,
      endDate,
    }, 0, selectedDays, globalSessionCount),
  ];
}

export function normalizeSchedulePlan(rawPlan, defaults = {}) {
  const selectedDays = uniqueSortedDays(
    rawPlan?.selectedDays?.length
      ? rawPlan.selectedDays
      : deriveSelectedDaysFromSchedule(defaults.schedule || '')
  );

  const globalSessionCount = clampSessionCount(
    rawPlan?.globalSessionCount
      ?? defaults.globalSessionCount
      ?? getRecommendedSessionCount(selectedDays)
  );
  const billingPeriods = createInitialBillingPeriods(rawPlan, defaults, selectedDays, globalSessionCount);
  const sessionStates = normalizeSessionStates(rawPlan?.sessionStates);

  const normalized = {
    version: rawPlan?.version || SCHEDULE_PLAN_VERSION,
    subject: normalizeSubject(rawPlan?.subject || defaults.subject),
    className: String(rawPlan?.className || defaults.className || '').trim(),
    selectedDays,
    globalSessionCount,
    billingPeriods,
    sessionStates,
    sessions: Array.isArray(rawPlan?.sessions) ? rawPlan.sessions : [],
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
  const selectedDays = uniqueSortedDays(planInput?.selectedDays);
  const globalSessionCount = clampSessionCount(planInput?.globalSessionCount);
  const sessionStates = normalizeSessionStates(planInput?.sessionStates);
  const billingPeriods = (planInput?.billingPeriods || []).map((period, index) =>
    createBillingPeriod(period, index, selectedDays, globalSessionCount)
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
    .filter((period) => period.startDateObj && period.endDateObj && period.startDateObj <= period.endDateObj);

  periodMeta.forEach((left, leftIndex) => {
    periodMeta.slice(leftIndex + 1).forEach((right) => {
      if (left.startDateObj <= right.endDateObj && right.startDateObj <= left.endDateObj) {
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
      const overrideState = override?.state || '';
      const hasBaseSession = selectedDays.includes(cursor.getDay());

      if (hasBaseSession || overrideState === 'force_active') {
        baseEntries.push({
          billingId: period.id,
          billingLabel: period.label,
          billingColor: period.color,
          date: dateString,
          dateObj: new Date(cursor),
          state: overrideState === 'force_active' || !overrideState ? 'active' : overrideState,
          rawState: overrideState || (hasBaseSession ? 'active' : 'force_active'),
          memo: override?.memo || '',
          makeupDate: override?.makeupDate || '',
          originalDate: null,
          isForced: overrideState === 'force_active',
        });

        if (overrideState === 'exception' && override?.makeupDate) {
          const makeupDateObj = parseDateValue(override.makeupDate);
          if (makeupDateObj) {
            baseEntries.push({
              billingId: period.id,
              billingLabel: period.label,
              billingColor: period.color,
              date: toDateString(makeupDateObj),
              dateObj: makeupDateObj,
              state: 'makeup',
              rawState: 'makeup',
              memo: '',
              makeupDate: '',
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
      return (STATE_PRIORITY[left.rawState] || 0) - (STATE_PRIORITY[right.rawState] || 0);
    });

    let countedSessions = 0;
    const editorEntries = [];

    baseEntries.forEach((entry) => {
      const countsTowardTotal = !['exception', 'tbd'].includes(entry.state);
      if (countsTowardTotal) {
        countedSessions += 1;
      }

      const session = {
        billingId: entry.billingId,
        billingLabel: entry.billingLabel,
        billingColor: entry.billingColor,
        date: entry.date,
        state: entry.state,
        memo: entry.memo,
        makeupDate: entry.makeupDate,
        originalDate: entry.originalDate,
        isForced: entry.isForced,
        sessionNumber: countsTowardTotal ? countedSessions : null,
      };

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
    return (STATE_PRIORITY[left.state] || 0) - (STATE_PRIORITY[right.state] || 0);
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
    editorEntriesByPeriod,
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

  return {
    version: normalized.version || SCHEDULE_PLAN_VERSION,
    subject: normalizeSubject(defaults.subject || normalized.subject),
    className: String(defaults.className || normalized.className || '').trim(),
    selectedDays: normalized.selectedDays,
    globalSessionCount: normalized.globalSessionCount,
    billingPeriods: calculated.billingPeriods.map((period) => ({
      id: period.id,
      month: period.month,
      label: period.label,
      startDate: period.startDate,
      endDate: period.endDate,
      totalSessions: period.totalSessions,
    })),
    sessionStates: normalized.sessionStates,
    sessions: calculated.sessions,
    generatedAt: new Date().toISOString(),
  };
}

export function getStateBadgeLabel(state) {
  switch (state) {
    case 'exception':
      return '휴강';
    case 'tbd':
      return '미정';
    case 'makeup':
      return '보강 수업';
    default:
      return '정상 수업';
  }
}

export function getStateTone(state) {
  switch (state) {
    case 'exception':
      return {
        background: 'rgba(239, 68, 68, 0.12)',
        color: '#b91c1c',
      };
    case 'tbd':
      return {
        background: 'rgba(245, 158, 11, 0.16)',
        color: '#b45309',
      };
    case 'makeup':
      return {
        background: 'rgba(16, 185, 129, 0.16)',
        color: '#047857',
      };
    default:
      return {
        background: 'rgba(33, 110, 78, 0.12)',
        color: 'var(--accent-color)',
      };
  }
}

export function formatPlannerDateLabel(dateString) {
  return getDateLabel(dateString);
}

export function getPeriodSummary(period) {
  const startLabel = period?.startDate || '-';
  const endLabel = period?.endDate || '-';
  return `${period?.label || '미정'} · ${startLabel} ~ ${endLabel}`;
}
