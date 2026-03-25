import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfWeek,
  startOfMonth,
} from "date-fns";
import { ko } from "date-fns/locale";

import {
  buildSessionProgressKey,
  buildSessionProgressLogPayloads,
} from "../../lib/classScheduleWorkspaceModel.js";

export const CLASS_SCHEDULE_VIEW_ITEMS = [
  { value: "timeline", label: "타임라인" },
  { value: "calendar", label: "캘린더" },
  { value: "table", label: "표" },
];

export const CLASS_SCHEDULE_ZOOM_ITEMS = [
  { value: "day", label: "일" },
  { value: "week", label: "주" },
  { value: "4week", label: "4주" },
];

export const CLASS_SCHEDULE_CALENDAR_MODE_ITEMS = [
  { value: "month", label: "월간" },
  { value: "week", label: "주간" },
];

export const PROGRESS_STATUS_ITEMS = [
  { value: "pending", label: "예정" },
  { value: "partial", label: "진행 중" },
  { value: "done", label: "완료" },
];

export function getPixelsPerDay(zoom = "week") {
  if (zoom === "day") return 34;
  if (zoom === "4week") return 8;
  return 18;
}

export function getTimelineLayoutMetrics(zoom = "week") {
  return {
    leftWidth: 252,
    headerHeight: 90,
    trackPadding: zoom === "4week" ? 12 : 16,
    classRowEstimate: 136,
    textbookRowEstimate: 56,
    classStepperTop: 48,
    classStepperSize: zoom === "day" ? 30 : zoom === "4week" ? 20 : 26,
    classStepperRailTop: 61,
    classBarTop: 22,
    classBarHeight: 18,
    classActualBarTop: 25,
    classActualBarHeight: 12,
    textbookStepperTop: 16,
    textbookStepperSize: zoom === "day" ? 24 : zoom === "4week" ? 16 : 20,
    textbookStepperRailTop: 26,
    textbookBarTop: 16,
    textbookBarHeight: 12,
    textbookActualBarTop: 18,
    textbookActualBarHeight: 8,
  };
}

export function getTimelineRowEstimate(type = "class", zoom = "week") {
  const metrics = getTimelineLayoutMetrics(zoom);
  return type === "textbook"
    ? metrics.textbookRowEstimate
    : metrics.classRowEstimate;
}

export function buildTimelineDayLabel(day, zoom = "week") {
  if (!day?.date) {
    return {
      primary: "",
      secondary: "",
      emphasis: "quiet",
    };
  }

  const isMonthStart = day.date.getDate() === 1;
  const isWeekStart = day.date.getDay() === 1;
  const isAnchor = day.isToday || isMonthStart || isWeekStart;

  if (zoom === "day") {
    return {
      primary: day.label,
      secondary: day.weekdayLabel,
      emphasis: day.isToday ? "today" : "major",
    };
  }

  if (zoom === "4week") {
    if (!isAnchor) {
      return {
        primary: "",
        secondary: "",
        emphasis: "quiet",
      };
    }

    return {
      primary: isMonthStart ? day.monthLabel : day.label,
      secondary: isMonthStart ? day.label : day.isToday ? "오늘" : day.weekdayLabel,
      emphasis: day.isToday ? "today" : "major",
    };
  }

  return {
    primary: day.label,
    secondary: isAnchor ? (day.isToday ? "오늘" : day.weekdayLabel) : "",
    emphasis: day.isToday ? "today" : isAnchor ? "major" : "quiet",
  };
}

export function safeText(value) {
  return String(value || "").trim();
}

export function resolveWorkspaceSelection(
  rows = [],
  selectedClassId = "",
  selectedSessionId = "",
  selectedTextbookId = "",
) {
  const row =
    (rows || []).find((item) => safeText(item?.classItem?.id) === safeText(selectedClassId)) ||
    (rows || [])[0] ||
    null;

  const session =
    (row?.sessions || []).find((item) => safeText(item?.id) === safeText(selectedSessionId)) ||
    (row?.sessions || [])[0] ||
    null;

  const entry =
    (session?.textbookEntries || []).find(
      (item) => safeText(item?.textbookId) === safeText(selectedTextbookId),
    ) ||
    (session?.textbookEntries || [])[0] ||
    null;

  return {
    row,
    session,
    entry,
    classId: safeText(row?.classItem?.id),
    sessionId: safeText(session?.id),
    textbookId: safeText(entry?.textbookId),
    key:
      row && session && entry
        ? `${safeText(row.classItem?.id)}:${safeText(session.id)}:${safeText(entry.textbookId)}`
        : "",
  };
}

export function buildInspectorSessionNavigator(sessions = [], selectedSessionId = "") {
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const selectedIndex = safeSessions.findIndex(
    (session) => safeText(session?.id) === safeText(selectedSessionId),
  );
  const resolvedIndex =
    selectedIndex >= 0 ? selectedIndex : safeSessions.length > 0 ? 0 : -1;
  const selectedSession = resolvedIndex >= 0 ? safeSessions[resolvedIndex] : null;
  const previousSession = resolvedIndex > 0 ? safeSessions[resolvedIndex - 1] : null;
  const nextSession =
    resolvedIndex >= 0 && resolvedIndex < safeSessions.length - 1
      ? safeSessions[resolvedIndex + 1]
      : null;

  const counts = safeSessions.reduce(
    (result, session) => {
      const status = safeText(session?.progressStatus || "pending");
      if (status === "done") {
        result.completedCount += 1;
      } else if (status === "partial") {
        result.partialCount += 1;
      } else {
        result.pendingCount += 1;
      }
      return result;
    },
    {
      completedCount: 0,
      partialCount: 0,
      pendingCount: 0,
    },
  );

  return {
    selectedIndex: resolvedIndex,
    totalSessions: safeSessions.length,
    selectedSession,
    previousSession,
    nextSession,
    ...counts,
  };
}

export function parseDateKey(value) {
  const raw = safeText(value);
  if (!raw) return null;
  try {
    const parsed = parseISO(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}

export function formatKoreanDate(value, pattern = "M.d (EEE)") {
  const date = value instanceof Date ? value : parseDateKey(value);
  if (!date) return "-";
  return format(date, pattern, { locale: ko });
}

export function formatRangeLabel(range = {}) {
  const label = safeText(range?.label);
  const start = safeText(range?.start);
  const end = safeText(range?.end);
  const parts = [];
  if (label) parts.push(label);
  if (start || end) {
    parts.push([start, end].filter(Boolean).join(" - "));
  }
  return parts.join(" / ");
}

export function getProgressTone(status = "pending") {
  if (status === "done") {
    return {
      bg: "rgba(49, 130, 246, 0.16)",
      text: "#155eef",
      border: "rgba(49, 130, 246, 0.24)",
    };
  }
  if (status === "partial") {
    return {
      bg: "rgba(22, 163, 74, 0.16)",
      text: "#15803d",
      border: "rgba(22, 163, 74, 0.24)",
    };
  }
  return {
    bg: "rgba(148, 163, 184, 0.14)",
    text: "#475467",
    border: "rgba(148, 163, 184, 0.22)",
  };
}

export function getWarningTone(variant = "") {
  if (variant === "ahead") {
    return {
      bg: "rgba(37, 99, 235, 0.12)",
      text: "#1d4ed8",
      border: "rgba(37, 99, 235, 0.16)",
    };
  }
  return {
    bg: "rgba(245, 158, 11, 0.16)",
    text: "#b45309",
    border: "rgba(245, 158, 11, 0.22)",
  };
}

export function buildCombinedProgressLogs(progressLogs = [], optimisticMap = {}) {
  const nextMap = new Map();

  (progressLogs || []).forEach((log) => {
    const key = safeText(log.progressKey || log.progress_key || log.id);
    if (key) {
      nextMap.set(key, log);
    }
  });

  Object.entries(optimisticMap || {}).forEach(([key, value]) => {
    if (!value) {
      nextMap.delete(key);
      return;
    }
    nextMap.set(key, value);
  });

  return [...nextMap.values()];
}

export function buildWorkspaceFilterOptions(rows = []) {
  const build = (values) => [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, "ko"));
  const termMap = new Map();
  rows.forEach((row) => {
    const termId = safeText(row.term?.id || row.classItem.termId || row.classItem.term_id);
    const termName = safeText(row.term?.name);
    if (termId) {
      termMap.set(termId, termName || termId);
    }
  });
  return {
    terms: [...termMap.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label, "ko")),
    subjects: build(rows.map((row) => safeText(row.classItem.subject))),
    grades: build(rows.map((row) => safeText(row.classItem.grade))),
    teachers: build(
      rows.flatMap((row) =>
        safeText(row.classItem.teacher)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ),
  };
}

export function buildWorkspaceSummary(rows = []) {
  const warningCount = rows.filter(
    (row) => row.warningSummary?.planDrift || row.warningSummary?.syncGap,
  ).length;
  const activeCount = rows.length;
  const actualDone = rows.reduce(
    (sum, row) =>
      sum +
      (row.sessions || []).filter((session) => session.progressStatus === "done").length,
    0,
  );
  const totalSessions = rows.reduce(
    (sum, row) => sum + (row.sessions || []).length,
    0,
  );
  return [
    { label: "운영 중 반", value: `${activeCount}개` },
    { label: "경고", value: `${warningCount}개` },
    { label: "완료 회차", value: `${actualDone}회` },
    { label: "전체 회차", value: `${totalSessions}회` },
  ];
}

export function buildSyncGroupCards(syncGroups = [], syncMembers = [], rows = [], classes = []) {
  const rowByClassId = new Map((rows || []).map((row) => [safeText(row?.classItem?.id), row]));
  const classById = new Map((classes || []).map((item) => [safeText(item?.id), item]));

  return (syncGroups || [])
    .map((group) => {
      const members = (syncMembers || [])
        .filter((member) => safeText(member?.groupId) === safeText(group?.id))
        .sort((left, right) => Number(left?.sortOrder || 0) - Number(right?.sortOrder || 0))
        .filter((member) => rowByClassId.has(safeText(member?.classId)))
        .map((member) => {
          const row = rowByClassId.get(safeText(member?.classId));
          const classItem = row?.classItem || classById.get(safeText(member?.classId)) || {};
          return {
            classId: member.classId,
            className: classItem.className || classItem.name || member.classId,
          };
        });

      const warningMessages = members
        .map((member) => rowByClassId.get(safeText(member?.classId))?.warningSummary?.syncGap?.message || "")
        .filter(Boolean);

      return {
        ...group,
        memberCount: members.length,
        members,
        warningText: warningMessages[0] || "",
      };
    })
    .filter((group) => group.memberCount > 0);
}

export function flattenTableRows(rows = [], textbooksCatalog = []) {
  const textbookTitleById = new Map(
    (textbooksCatalog || []).map((item) => [safeText(item.id), safeText(item.title)]),
  );

  return rows.flatMap((row) =>
    (row.sessions || []).flatMap((session) =>
      (session.textbookEntries || []).map((entry) => ({
        key: `${row.classItem.id}:${session.id}:${entry.textbookId}`,
        row,
        session,
        entry,
        className: safeText(row.classItem.className || row.classItem.name),
        subject: safeText(row.classItem.subject),
        grade: safeText(row.classItem.grade),
        teacher: safeText(row.classItem.teacher),
        termName: safeText(row.term?.name),
        date: safeText(session.date),
        sessionNumber: Number(session.sessionNumber || 0),
        textbookTitle:
          textbookTitleById.get(safeText(entry.textbookId)) || safeText(entry.textbookId),
        plannedRange: formatRangeLabel(entry.plan),
        actualRange: formatRangeLabel(entry.actual),
        actualStatus: safeText(entry.actual?.status || session.progressStatus || "pending"),
        progressWarning: row.warningSummary?.planDrift || null,
        syncWarning: row.warningSummary?.syncGap || null,
      })),
    ),
  );
}

export function buildCalendarData(rows = [], monthDate = new Date(), mode = "month") {
  const baseDate = monthDate instanceof Date ? monthDate : new Date();
  const start =
    mode === "week" ? startOfWeek(baseDate, { weekStartsOn: 0 }) : startOfWeek(startOfMonth(baseDate), { weekStartsOn: 0 });
  const end =
    mode === "week" ? endOfWeek(baseDate, { weekStartsOn: 0 }) : endOfWeek(endOfMonth(baseDate), { weekStartsOn: 0 });

  const byDate = new Map();
  rows.forEach((row) => {
    (row.sessions || []).forEach((session) => {
      const key = safeText(session.date);
      if (!key) return;
      const current = byDate.get(key) || [];
      current.push({
        row,
        session,
      });
      byDate.set(key, current);
    });
  });

  return eachDayOfInterval({ start, end }).map((date) => {
    const key = format(date, "yyyy-MM-dd");
    return {
      key,
      date,
      isCurrentMonth: isSameMonth(date, baseDate),
      sessions: (byDate.get(key) || []).sort(
        (left, right) =>
          Number(left.session.sessionNumber || 0) - Number(right.session.sessionNumber || 0),
      ),
    };
  });
}

export function formatWarningSummary(warning = null) {
  if (!warning) return "";
  return warning.message || "";
}

export function createProgressDraft(row, session, entry) {
  return {
    classId: safeText(row?.classItem?.id),
    sessionId: safeText(session?.id),
    textbookId: safeText(entry?.textbookId),
    status: safeText(entry?.actual?.status || "pending") || "pending",
    rangeStart: safeText(entry?.actual?.start),
    rangeEnd: safeText(entry?.actual?.end),
    rangeLabel: safeText(entry?.actual?.label),
    publicNote: safeText(entry?.actual?.publicNote),
    teacherNote: safeText(entry?.actual?.teacherNote),
  };
}

export function buildInspectorSessionSummary(row = null, selectedSessionId = "", limit = 6) {
  const sessions = Array.isArray(row?.sessions) ? row.sessions : [];
  const warningCount =
    Number(Boolean(row?.warningSummary?.planDrift)) +
    Number(Boolean(row?.warningSummary?.syncGap));

  if (!sessions.length) {
    return {
      selectedSession: null,
      selectedSessionId: "",
      selectedIndex: -1,
      selectedPosition: 0,
      previousSessionId: "",
      nextSessionId: "",
      visibleSessions: [],
      visibleSessionIds: [],
      visibleRangeStart: 0,
      visibleRangeEnd: 0,
      totalSessions: 0,
      doneCount: 0,
      partialCount: 0,
      pendingCount: 0,
      warningCount,
      hasHiddenBefore: false,
      hasHiddenAfter: false,
    };
  }

  const rawIndex = sessions.findIndex((session) => session.id === selectedSessionId);
  const selectedIndex = rawIndex >= 0 ? rawIndex : 0;
  const windowSize = Math.max(1, Number(limit) || 6);
  const maxStart = Math.max(sessions.length - windowSize, 0);
  const visibleStart = Math.max(
    0,
    Math.min(selectedIndex - Math.floor(windowSize / 2), maxStart),
  );
  const visibleEnd = Math.min(visibleStart + windowSize, sessions.length);
  const visibleSessions = sessions.slice(visibleStart, visibleEnd);
  const doneCount = sessions.filter((session) => session.progressStatus === "done").length;
  const partialCount = sessions.filter((session) => session.progressStatus === "partial").length;
  const pendingCount = Math.max(sessions.length - doneCount - partialCount, 0);
  const selectedSession = sessions[selectedIndex] || null;

  return {
    selectedSession,
    selectedSessionId: safeText(selectedSession?.id),
    selectedIndex,
    selectedPosition: selectedIndex + 1,
    previousSessionId: selectedIndex > 0 ? safeText(sessions[selectedIndex - 1]?.id) : "",
    nextSessionId:
      selectedIndex < sessions.length - 1 ? safeText(sessions[selectedIndex + 1]?.id) : "",
    visibleSessions,
    visibleSessionIds: visibleSessions.map((session) => safeText(session.id)),
    visibleRangeStart: visibleStart + 1,
    visibleRangeEnd: visibleEnd,
    totalSessions: sessions.length,
    doneCount,
    partialCount,
    pendingCount,
    warningCount,
    hasHiddenBefore: visibleStart > 0,
    hasHiddenAfter: visibleEnd < sessions.length,
  };
}

export function isProgressDraftEmpty(draft = {}) {
  return (
    safeText(draft.status || "pending") === "pending" &&
    !safeText(draft.rangeStart) &&
    !safeText(draft.rangeEnd) &&
    !safeText(draft.rangeLabel) &&
    !safeText(draft.publicNote) &&
    !safeText(draft.teacherNote)
  );
}

export function buildSessionProgressPayload({ row, session, entry, draft }) {
  const classId = safeText(row?.classItem?.id);
  const sessionId = safeText(session?.id);
  const textbookId = safeText(entry?.textbookId);

  return {
    classId,
    sessionId,
    textbookId,
    sessionOrder: Number(session?.sessionNumber || 0),
    progressKey: buildSessionProgressKey(classId, sessionId, textbookId),
    status: safeText(draft?.status || "pending") || "pending",
    rangeStart: safeText(draft?.rangeStart),
    rangeEnd: safeText(draft?.rangeEnd),
    rangeLabel: safeText(draft?.rangeLabel),
    publicNote: safeText(draft?.publicNote),
    teacherNote: safeText(draft?.teacherNote),
    updatedAt: new Date().toISOString(),
  };
}

export function buildChecklistPayloads({ classItem, schedulePlan, textbooksCatalog = [] }) {
  return buildSessionProgressLogPayloads({
    classItem,
    schedulePlan,
    textbooksCatalog,
  });
}

export function buildTimelineRows(rows = [], expandedClassIds = new Set()) {
  return rows.flatMap((row) => {
    const base = [{ type: "class", key: row.classItem.id, row }];
    if (!expandedClassIds.has(row.classItem.id)) {
      return base;
    }
    const textbookRows = [];
    const seenIds = new Set();

    (row.sessions || []).forEach((session) => {
      (session.textbookEntries || []).forEach((entry) => {
        const textbookId = safeText(entry.textbookId);
        if (!textbookId || seenIds.has(textbookId)) {
          return;
        }

        seenIds.add(textbookId);
        textbookRows.push({
          type: "textbook",
          key: `${row.classItem.id}:${textbookId}`,
          row,
          textbookId,
          textbookTitle:
            safeText(entry.textbookTitle) ||
            safeText(entry.title) ||
            safeText(entry.textbookName) ||
            textbookId,
        });
      });
    });

    return [
      ...base,
      ...textbookRows,
    ];
  });
}

function buildAxisSegments(days = [], getKey, getLabel) {
  if (!days.length) return [];

  const segments = [];
  let startIndex = 0;
  let currentKey = getKey(days[0].date);

  days.forEach((day, index) => {
    const nextKey = getKey(day.date);
    if (nextKey === currentKey) {
      return;
    }

    segments.push({
      key: currentKey,
      label: getLabel(days[startIndex].date, days[index - 1].date),
      startIndex,
      span: index - startIndex,
    });
    startIndex = index;
    currentKey = nextKey;
  });

  segments.push({
    key: currentKey,
    label: getLabel(days[startIndex].date, days[days.length - 1].date),
    startIndex,
    span: days.length - startIndex,
  });

  return segments;
}

export function buildTimelineAxis(timelineRange = { start: "", end: "" }) {
  const start = parseDateKey(timelineRange.start);
  const end = parseDateKey(timelineRange.end);
  if (!start || !end) {
    return {
      days: [],
      weeks: [],
      months: [],
      totalDays: 0,
    };
  }

  const days = eachDayOfInterval({ start, end }).map((date) => ({
    key: format(date, "yyyy-MM-dd"),
    date,
    label: format(date, "d", { locale: ko }),
    weekdayLabel: format(date, "EEE", { locale: ko }),
    monthLabel: format(date, "M월", { locale: ko }),
    isToday: isSameDay(date, new Date()),
  }));

  return {
    days,
    weeks: buildAxisSegments(
      days,
      (date) => format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      (startDate, endDate) =>
        `${format(startDate, "M.d", { locale: ko })} - ${format(endDate, "M.d", { locale: ko })}`,
    ),
    months: buildAxisSegments(
      days,
      (date) => format(date, "yyyy-MM"),
      (startDate) => format(startDate, "yyyy년 M월", { locale: ko }),
    ),
    totalDays: days.length,
  };
}

export function getDayOffset(dateKey, timelineStart) {
  const date = parseDateKey(dateKey);
  const start = parseDateKey(timelineStart);
  if (!date || !start) return 0;
  return differenceInCalendarDays(date, start);
}

export function getSessionSpan(session = {}, timelineStart = "") {
  const dayOffset = getDayOffset(session.date, timelineStart);
  return {
    left: Math.max(dayOffset, 0),
    width: 1,
  };
}

export function getSessionBarMetrics(
  session = {},
  timelineStart = "",
  pixelsPerDay = 18,
) {
  return getTimelineSessionGeometry(session, timelineStart, pixelsPerDay, 0);
}

export function getTimelineSessionGeometry(
  session = {},
  timelineStart = "",
  pixelsPerDay = getPixelsPerDay("week"),
  trackPadding = 0,
) {
  const span = getSessionSpan(session, timelineStart);
  const minWidth = pixelsPerDay >= 28 ? 26 : pixelsPerDay >= 18 ? 18 : 14;
  const width = Math.max(span.width * pixelsPerDay - 6, minWidth);
  const centeredOffset = Math.max(Math.round((pixelsPerDay - width) / 2), 0);

  return {
    left: trackPadding + span.left * pixelsPerDay + centeredOffset,
    width,
  };
}

export function getTimelineStepperNodeGeometry(
  session = {},
  timelineStart = "",
  pixelsPerDay = getPixelsPerDay("week"),
  trackPadding = 0,
  nodeSize = 24,
) {
  const geometry = getTimelineSessionGeometry(
    session,
    timelineStart,
    pixelsPerDay,
    trackPadding,
  );
  const center = geometry.left + geometry.width / 2;

  return {
    center,
    left: Math.round(center - nodeSize / 2),
    size: nodeSize,
  };
}

export function getTimelineScheduleRailGeometry(
  sessions = [],
  timelineStart = "",
  pixelsPerDay = getPixelsPerDay("week"),
  trackPadding = 0,
) {
  const datedSessions = (sessions || []).filter((session) => safeText(session?.date));
  if (datedSessions.length === 0) {
    return {
      left: trackPadding,
      width: 0,
    };
  }

  const firstGeometry = getTimelineSessionGeometry(
    datedSessions[0],
    timelineStart,
    pixelsPerDay,
    trackPadding,
  );
  const lastGeometry = getTimelineSessionGeometry(
    datedSessions[datedSessions.length - 1],
    timelineStart,
    pixelsPerDay,
    trackPadding,
  );

  return {
    left: firstGeometry.left,
    width: Math.max(lastGeometry.left + lastGeometry.width - firstGeometry.left, firstGeometry.width),
  };
}
