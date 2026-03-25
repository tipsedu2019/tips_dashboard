import {
  calculateSchedulePlan,
  normalizeSchedulePlan,
  parseDateValue,
  toDateString,
} from "./classSchedulePlanner.js";

export const DEFAULT_CLASS_SCHEDULE_VIEW_STATE = {
  version: 1,
  view: "timeline",
  timelineZoom: "week",
  calendarMode: "month",
  density: "compact",
  filters: {
    termId: "",
    subject: "",
    grade: "",
    teacher: "",
  },
  inspectorOpen: true,
  selectedSyncGroupId: "",
  showWarningsOnly: false,
};

const VIEW_OPTIONS = new Set(["timeline", "calendar", "table"]);
const TIMELINE_ZOOMS = new Set(["day", "week", "4week"]);
const CALENDAR_MODES = new Set(["month", "week"]);
const DENSITY_OPTIONS = new Set(["comfortable", "compact"]);

function text(value) {
  return String(value || "").trim();
}

function normalizeDateInput(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : toDateString(value);
  }
  const raw = text(value);
  if (!raw) return "";
  const parsed = parseDateValue(raw);
  return parsed ? toDateString(parsed) : "";
}

function isCountedScheduleState(state) {
  return !["exception", "tbd"].includes(text(state));
}

function hasActualContent(actual = {}) {
  return Boolean(
    text(actual?.start) ||
      text(actual?.end) ||
      text(actual?.label) ||
      text(actual?.publicNote) ||
      text(actual?.teacherNote) ||
      (text(actual?.status) && text(actual?.status) !== "pending"),
  );
}

function normalizeProgressStatus(value) {
  const normalized = text(value);
  if (normalized === "done" || normalized === "partial") {
    return normalized;
  }
  return "pending";
}

function getProgressStatusFromEntries(entries = []) {
  const statuses = (entries || [])
    .map((entry) => normalizeProgressStatus(entry?.actual?.status))
    .filter(Boolean);

  if (statuses.length === 0 || statuses.every((status) => status === "pending")) {
    return "pending";
  }

  if (statuses.every((status) => status === "done")) {
    return "done";
  }

  return "partial";
}

function normalizeProgressLog(log = {}) {
  return {
    ...log,
    classId: text(log.classId || log.class_id),
    textbookId: text(log.textbookId || log.textbook_id),
    sessionId: text(log.sessionId || log.session_id),
    sessionOrder: Number(log.sessionOrder || log.session_order || 0) || 0,
    progressKey: text(log.progressKey || log.progress_key),
    status: normalizeProgressStatus(log.status),
    rangeStart: text(log.rangeStart || log.range_start),
    rangeEnd: text(log.rangeEnd || log.range_end),
    rangeLabel: text(log.rangeLabel || log.range_label),
    publicNote: text(log.publicNote || log.public_note),
    teacherNote: text(log.teacherNote || log.teacher_note),
    updatedAt: text(log.updatedAt || log.updated_at || log.date),
    date: text(log.date),
    content: text(log.content),
    homework: text(log.homework),
  };
}

function getProgressLogTimestamp(log = {}) {
  const raw = text(log.updatedAt || log.date);
  if (!raw) return 0;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function chooseNewerProgressLog(current, candidate) {
  if (!current) return candidate;
  return getProgressLogTimestamp(candidate) >= getProgressLogTimestamp(current)
    ? candidate
    : current;
}

function buildProgressLogMaps(progressLogs = [], classId = "") {
  const byProgressKey = new Map();
  const bySessionAndTextbook = new Map();
  const bySessionOrderAndTextbook = new Map();

  (progressLogs || [])
    .map((log) => normalizeProgressLog(log))
    .filter((log) => log.classId === classId && log.sessionId)
    .forEach((log) => {
      if (log.progressKey) {
        byProgressKey.set(
          log.progressKey,
          chooseNewerProgressLog(byProgressKey.get(log.progressKey), log),
        );
      }

      const sessionTextbookKey = `${log.sessionId}:${log.textbookId}`;
      bySessionAndTextbook.set(
        sessionTextbookKey,
        chooseNewerProgressLog(bySessionAndTextbook.get(sessionTextbookKey), log),
      );

      if (log.sessionOrder > 0) {
        const sessionOrderKey = `${log.sessionOrder}:${log.textbookId}`;
        bySessionOrderAndTextbook.set(
          sessionOrderKey,
          chooseNewerProgressLog(
            bySessionOrderAndTextbook.get(sessionOrderKey),
            log,
          ),
        );
      }
    });

  return { byProgressKey, bySessionAndTextbook, bySessionOrderAndTextbook };
}

function buildActualFromProgressLog(fallbackActual = {}, progressLog = null) {
  if (!progressLog) {
    return {
      ...fallbackActual,
      status: normalizeProgressStatus(fallbackActual?.status),
    };
  }

  return {
    ...fallbackActual,
    status: progressLog.status,
    start: progressLog.rangeStart || fallbackActual?.start || "",
    end: progressLog.rangeEnd || fallbackActual?.end || "",
    label: progressLog.rangeLabel || fallbackActual?.label || "",
    publicNote: progressLog.publicNote || fallbackActual?.publicNote || "",
    teacherNote: progressLog.teacherNote || fallbackActual?.teacherNote || "",
    updatedAt:
      progressLog.updatedAt ||
      fallbackActual?.updatedAt ||
      progressLog.date ||
      "",
  };
}

function buildTextbookTitleMap(textbooksCatalog = [], plannerTextbooks = []) {
  const titleById = new Map();

  (textbooksCatalog || []).forEach((item) => {
    const textbookId = text(item?.id);
    if (!textbookId) return;
    titleById.set(textbookId, text(item?.title || item?.name));
  });

  (plannerTextbooks || []).forEach((item) => {
    const textbookId = text(item?.textbookId || item?.id);
    if (!textbookId) return;

    const alias = text(item?.alias);
    if (alias) {
      titleById.set(textbookId, alias);
      return;
    }

    if (!titleById.has(textbookId)) {
      titleById.set(textbookId, textbookId);
    }
  });

  return titleById;
}

function buildPlanDriftWarning(latestPlannedSessionIndex, latestActualSessionIndex) {
  const gap = Number(latestActualSessionIndex || 0) - Number(latestPlannedSessionIndex || 0);
  if (gap === 0) {
    return null;
  }

  return {
    sessions: Math.abs(gap),
    variant: gap < 0 ? "behind" : "ahead",
    message:
      gap < 0
        ? `계획보다 ${Math.abs(gap)}회차 뒤처짐`
        : `계획보다 ${Math.abs(gap)}회차 앞섬`,
  };
}

function buildSyncGapWarning(row, peers = []) {
  if (!row?.syncGroupId || peers.length <= 1) {
    return null;
  }

  const currentIndex = Number(row.latestActualSessionIndex || 0);
  const aheadPeer = peers.reduce((best, peer) => {
    if (peer.classItem.id === row.classItem.id) return best;
    const peerIndex = Number(peer.latestActualSessionIndex || 0);
    if (peerIndex <= currentIndex) return best;
    if (!best || peerIndex > best.latestActualSessionIndex) {
      return peer;
    }
    return best;
  }, null);

  if (aheadPeer) {
    const sessions = Number(aheadPeer.latestActualSessionIndex || 0) - currentIndex;
    return {
      sessions,
      variant: "behind",
      message: `${row.classItem.className || row.classItem.name}이 ${aheadPeer.classItem.className || aheadPeer.classItem.name}보다 ${sessions}회차 뒤처짐`,
    };
  }

  const behindPeer = peers.reduce((best, peer) => {
    if (peer.classItem.id === row.classItem.id) return best;
    const peerIndex = Number(peer.latestActualSessionIndex || 0);
    if (peerIndex >= currentIndex) return best;
    if (!best || peerIndex < best.latestActualSessionIndex) {
      return peer;
    }
    return best;
  }, null);

  if (!behindPeer) {
    return null;
  }

  const sessions = currentIndex - Number(behindPeer.latestActualSessionIndex || 0);
  return {
    sessions,
    variant: "ahead",
    message: `${row.classItem.className || row.classItem.name}이 ${behindPeer.classItem.className || behindPeer.classItem.name}보다 ${sessions}회차 앞섬`,
  };
}

export function buildSessionProgressKey(classId, sessionId, textbookId) {
  return [text(classId), text(sessionId), text(textbookId)].join(":");
}

export function restoreClassScheduleViewState(raw = null) {
  const safe = raw && typeof raw === "object" ? raw : {};

  return {
    version: 1,
    view: VIEW_OPTIONS.has(safe.view) ? safe.view : DEFAULT_CLASS_SCHEDULE_VIEW_STATE.view,
    timelineZoom: TIMELINE_ZOOMS.has(safe.timelineZoom)
      ? safe.timelineZoom
      : DEFAULT_CLASS_SCHEDULE_VIEW_STATE.timelineZoom,
    calendarMode: CALENDAR_MODES.has(safe.calendarMode)
      ? safe.calendarMode
      : DEFAULT_CLASS_SCHEDULE_VIEW_STATE.calendarMode,
    density: DENSITY_OPTIONS.has(safe.density)
      ? safe.density
      : DEFAULT_CLASS_SCHEDULE_VIEW_STATE.density,
    filters: {
      ...DEFAULT_CLASS_SCHEDULE_VIEW_STATE.filters,
      ...(safe.filters && typeof safe.filters === "object" ? {
        termId: text(safe.filters.termId),
        subject: text(safe.filters.subject),
        grade: text(safe.filters.grade),
        teacher: text(safe.filters.teacher),
      } : {}),
    },
    inspectorOpen:
      typeof safe.inspectorOpen === "boolean"
        ? safe.inspectorOpen
        : DEFAULT_CLASS_SCHEDULE_VIEW_STATE.inspectorOpen,
    selectedSyncGroupId: text(safe.selectedSyncGroupId),
    showWarningsOnly: Boolean(safe.showWarningsOnly),
  };
}

export function createMergedClassScheduleModel({
  classItem = {},
  textbooksCatalog = [],
  progressLogs = [],
  plan = null,
  now = new Date(),
} = {}) {
  const safeClass = classItem || {};
  const classId = text(safeClass.id);
  const textbookIds = Array.isArray(safeClass.textbookIds)
    ? safeClass.textbookIds
    : [];

  const planner = normalizeSchedulePlan(
    plan || safeClass.schedulePlan || safeClass.schedule_plan || null,
    {
      className: safeClass.className || safeClass.name || "",
      subject: safeClass.subject || "",
      schedule: safeClass.schedule || "",
      startDate: safeClass.startDate || safeClass.start_date || "",
      endDate: safeClass.endDate || safeClass.end_date || "",
      textbookIds,
      textbooks: textbooksCatalog,
    },
  );

  const calculation = calculateSchedulePlan(planner);
  const progressLogMaps = buildProgressLogMaps(progressLogs, classId);
  const textbookTitleById = buildTextbookTitleMap(textbooksCatalog, calculation.textbooks);
  const sessions = (calculation.sessions || []).map((session) => {
    const textbookEntries = (session.textbookEntries || []).map((entry) => {
      const progressKey = buildSessionProgressKey(classId, session.id, entry.textbookId);
      const progressLog =
        progressLogMaps.byProgressKey.get(progressKey) ||
        progressLogMaps.bySessionAndTextbook.get(`${session.id}:${entry.textbookId}`) ||
        progressLogMaps.bySessionOrderAndTextbook.get(
          `${Number(session.sessionNumber || 0)}:${entry.textbookId}`,
        ) ||
        null;

      return {
        ...entry,
        textbookTitle:
          text(entry.textbookTitle) ||
          textbookTitleById.get(text(entry.textbookId)) ||
          text(entry.textbookId),
        actual: buildActualFromProgressLog(entry.actual || {}, progressLog),
      };
    });

    const progressStatus = getProgressStatusFromEntries(textbookEntries);
    const sessionPublicNote =
      text(session.publicNote) ||
      textbookEntries.find((entry) => text(entry.actual?.publicNote))?.actual?.publicNote ||
      "";
    const sessionTeacherNote =
      text(session.teacherNote) ||
      textbookEntries.find((entry) => text(entry.actual?.teacherNote))?.actual?.teacherNote ||
      "";

    return {
      ...session,
      progressStatus,
      publicNote: sessionPublicNote,
      teacherNote: sessionTeacherNote,
      textbookEntries,
    };
  });

  const today = normalizeDateInput(now) || toDateString(new Date());
  const countedSessions = sessions.filter((session) =>
    isCountedScheduleState(session.scheduleState),
  );
  const latestPlannedSessionIndex = countedSessions.reduce((maxValue, session) => {
    if (normalizeDateInput(session.date) && normalizeDateInput(session.date) <= today) {
      return Math.max(maxValue, Number(session.sessionNumber || 0));
    }
    return maxValue;
  }, 0);
  const latestActualSessionIndex = countedSessions.reduce((maxValue, session) => {
    const hasActual = (session.textbookEntries || []).some((entry) =>
      hasActualContent(entry.actual),
    );
    if (!hasActual) return maxValue;
    return Math.max(maxValue, Number(session.sessionNumber || 0));
  }, 0);

  return {
    classItem: safeClass,
    planner,
    calculation: {
      ...calculation,
      sessions,
    },
    sessions,
    latestPlannedSessionIndex,
    latestActualSessionIndex,
    warningSummary: {
      planDrift: buildPlanDriftWarning(
        latestPlannedSessionIndex,
        latestActualSessionIndex,
      ),
      syncGap: null,
    },
  };
}

export function buildSessionProgressLogPayloads({
  classItem = {},
  schedulePlan = null,
  textbooksCatalog = [],
} = {}) {
  const safeClass = classItem || {};
  const classId = text(safeClass.id);

  if (!classId) {
    return [];
  }

  const planner = normalizeSchedulePlan(
    schedulePlan || safeClass.schedulePlan || safeClass.schedule_plan || null,
    {
      className: safeClass.className || safeClass.name || "",
      subject: safeClass.subject || "",
      schedule: safeClass.schedule || "",
      startDate: safeClass.startDate || safeClass.start_date || "",
      endDate: safeClass.endDate || safeClass.end_date || "",
      textbookIds: Array.isArray(safeClass.textbookIds) ? safeClass.textbookIds : [],
      textbooks: textbooksCatalog,
    },
  );

  return (calculateSchedulePlan(planner).sessions || []).flatMap((session) =>
    (session.textbookEntries || [])
      .filter((entry) => hasActualContent(entry.actual))
      .map((entry) => ({
        classId,
        textbookId: text(entry.textbookId),
        sessionId: text(session.id),
        sessionOrder: Number(session.sessionNumber || 0),
        progressKey: buildSessionProgressKey(classId, session.id, entry.textbookId),
        status: normalizeProgressStatus(entry.actual?.status),
        rangeStart: text(entry.actual?.start),
        rangeEnd: text(entry.actual?.end),
        rangeLabel: text(entry.actual?.label),
        publicNote: text(entry.actual?.publicNote),
        teacherNote: text(entry.actual?.teacherNote),
        updatedAt: text(entry.actual?.updatedAt) || new Date().toISOString(),
      })),
  );
}

export function buildClassScheduleWorkspaceData({
  classes = [],
  textbooks = [],
  progressLogs = [],
  classTerms = [],
  syncGroups = [],
  syncGroupMembers = [],
  filters = {},
  now = new Date(),
} = {}) {
  const membershipByClassId = new Map();
  (syncGroupMembers || []).forEach((member) => {
    membershipByClassId.set(text(member.classId || member.class_id), {
      ...member,
      groupId: text(member.groupId || member.group_id),
    });
  });

  const groupsById = new Map(
    (syncGroups || []).map((group) => [
      text(group.id),
      {
        ...group,
        id: text(group.id),
        termId: text(group.termId || group.term_id),
      },
    ]),
  );
  const termsById = new Map(
    (classTerms || []).map((term) => [text(term.id), term]),
  );
  const normalizedFilters = restoreClassScheduleViewState({ filters }).filters;

  const workspaceErrors = [];

  const rows = (classes || [])
    .filter((classItem) => {
      const termId = text(classItem.termId || classItem.term_id);
      if (normalizedFilters.termId && termId !== normalizedFilters.termId) {
        return false;
      }
      if (normalizedFilters.subject && text(classItem.subject) !== normalizedFilters.subject) {
        return false;
      }
      if (normalizedFilters.grade && text(classItem.grade) !== normalizedFilters.grade) {
        return false;
      }
      if (
        normalizedFilters.teacher &&
        !text(classItem.teacher).split(",").map((item) => item.trim()).includes(normalizedFilters.teacher)
      ) {
        return false;
      }
      return true;
    })
    .flatMap((classItem) => {
      try {
        const model = createMergedClassScheduleModel({
          classItem,
          textbooksCatalog: textbooks,
          progressLogs,
          now,
        });
        const membership = membershipByClassId.get(text(classItem.id)) || null;
        const syncGroup = membership ? groupsById.get(membership.groupId) || null : null;

        return [{
          ...model,
          syncGroupId: syncGroup?.id || "",
          syncGroup,
          syncMembership: membership,
          term: termsById.get(text(classItem.termId || classItem.term_id)) || null,
        }];
      } catch (error) {
        workspaceErrors.push({
          classId: text(classItem?.id),
          className: text(classItem?.className || classItem?.name),
          message: text(error?.message || error),
        });
        return [];
      }
    });

  const rowsByGroup = rows.reduce((result, row) => {
    if (!row.syncGroupId) return result;
    const list = result.get(row.syncGroupId) || [];
    list.push(row);
    result.set(row.syncGroupId, list);
    return result;
  }, new Map());

  const nextRows = rows.map((row) => ({
    ...row,
    warningSummary: {
      ...row.warningSummary,
      syncGap: buildSyncGapWarning(row, rowsByGroup.get(row.syncGroupId) || []),
    },
  }));

  const sessionDates = nextRows.flatMap((row) =>
    (row.sessions || []).map((session) => normalizeDateInput(session.date)).filter(Boolean),
  );

  return {
    rows: nextRows,
    errors: workspaceErrors,
    syncGroups: (syncGroups || []).map((group) => ({
      ...group,
      id: text(group.id),
      termId: text(group.termId || group.term_id),
    })),
    timelineRange: {
      start: sessionDates.length > 0 ? sessionDates.slice().sort()[0] : "",
      end: sessionDates.length > 0 ? sessionDates.slice().sort().at(-1) : "",
    },
  };
}
