function text(value) {
  return String(value || "").trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function parseDate(value) {
  const raw = text(value);
  if (!raw) {
    return null;
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toDateKey(value) {
  return formatDate(parseDate(value));
}

function buildMonthRange(month = "") {
  const [year, monthNumber] = text(month).split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber)) {
    const today = new Date();
    return buildMonthRange(
      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`,
    );
  }

  const start = new Date(year, monthNumber - 1, 1);
  const end = new Date(year, monthNumber, 0);

  return { start, end };
}

function splitList(value) {
  return text(value)
    .split(/[,/&·\n]+/)
    .map((item) => text(item))
    .filter(Boolean);
}

function normalizeSchool(row = {}) {
  return {
    id: text(row.id),
    name: text(row.name),
    category: text(row.category) || "all",
  };
}

function normalizeEventType(value) {
  return text(value) || "기타";
}

function normalizeAcademicEvent(row = {}, schoolsById = new Map()) {
  const schoolId = text(row.school_id || row.schoolId);
  const matchedSchool = schoolId ? schoolsById.get(schoolId) : null;
  const start = text(row.start || row.start_date || row.date);
  const end = text(row.end || row.end_date || row.date || start);

  return {
    id: text(row.id),
    title: text(row.title) || "제목 없는 일정",
    type: normalizeEventType(row.type),
    start,
    end,
    grade: text(row.grade),
    schoolId,
    schoolName: text(row.school || matchedSchool?.name),
    category: text(row.category || matchedSchool?.category) || "all",
    note: text(row.note),
  };
}

function isEventVisible(event, filters = {}) {
  if (text(filters.category) && event.category !== text(filters.category)) {
    return false;
  }
  if (text(filters.type) && event.type !== text(filters.type)) {
    return false;
  }
  if (text(filters.schoolId) && event.schoolId !== text(filters.schoolId)) {
    return false;
  }
  if (text(filters.search)) {
    const keyword = text(filters.search).toLowerCase();
    const haystack = [event.title, event.schoolName, event.type, event.grade, event.note]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(keyword)) {
      return false;
    }
  }
  return true;
}

function overlapsMonth(event, monthRange) {
  const eventStart = toDateKey(event.start);
  const eventEnd = toDateKey(event.end || event.start);
  const monthStart = formatDate(monthRange.start);
  const monthEnd = formatDate(monthRange.end);

  if (!eventStart || !eventEnd || !monthStart || !monthEnd) {
    return false;
  }

  return eventStart <= monthEnd && eventEnd >= monthStart;
}

function buildCalendarDays(events, monthRange) {
  const days = [];
  let cursor = new Date(monthRange.start);

  while (cursor <= monthRange.end) {
    const dateKey = formatDate(cursor);
    days.push({
      date: dateKey,
      day: cursor.getDate(),
      events: events.filter((event) => {
        const eventStart = toDateKey(event.start);
        const eventEnd = toDateKey(event.end || event.start);
        if (!eventStart || !eventEnd) {
          return false;
        }
        return eventStart <= dateKey && eventEnd >= dateKey;
      }),
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
  }

  return days;
}

export function buildAcademicCalendarWorkspaceModel({
  academicEvents = [],
  academicSchools = [],
  filters = {},
  month = "",
} = {}) {
  const normalizedSchools = (academicSchools || []).map(normalizeSchool);
  const schoolsById = new Map(normalizedSchools.map((school) => [school.id, school]));
  const normalizedEvents = (academicEvents || [])
    .map((row) => normalizeAcademicEvent(row, schoolsById))
    .filter((event) => event.start);
  const monthRange = buildMonthRange(month);

  const visibleEvents = normalizedEvents.filter((event) => isEventVisible(event, filters));
  const monthEvents = visibleEvents
    .filter((event) => overlapsMonth(event, monthRange))
    .sort((left, right) => {
      const startGap = text(left.start).localeCompare(text(right.start));
      if (startGap !== 0) {
        return startGap;
      }
      return left.title.localeCompare(right.title, "ko");
    });

  return {
    month: `${monthRange.start.getFullYear()}-${String(monthRange.start.getMonth() + 1).padStart(2, "0")}`,
    days: buildCalendarDays(monthEvents, monthRange),
    events: monthEvents,
    upcomingEvents: monthEvents,
    monthOptions: unique(
      normalizedEvents
        .map((event) => text(event.start).slice(0, 7))
        .filter((value) => /^\d{4}-\d{2}$/.test(value)),
    ).sort(),
    typeOptions: unique(normalizedEvents.map((event) => event.type)).sort((left, right) =>
      left.localeCompare(right, "ko"),
    ),
    schoolOptions: normalizedSchools
      .map((school) => ({ value: school.id, label: school.name }))
      .sort((left, right) => left.label.localeCompare(right.label, "ko")),
    categoryOptions: unique(normalizedSchools.map((school) => school.category)).sort(),
    summary: {
      eventCount: monthEvents.length,
      schoolCount: new Set(
        monthEvents.map((event) => event.schoolId || event.schoolName).filter(Boolean),
      ).size,
      upcomingCount: monthEvents.length,
      typeCount: new Set(monthEvents.map((event) => event.type)).size,
    },
  };
}

function normalizeSyncGroup(group = {}) {
  return {
    ...group,
    id: text(group.id),
    subject: text(group.subject),
    name: text(group.name),
    termId: text(group.termId || group.term_id),
  };
}

function normalizeSyncGroupMember(member = {}) {
  return {
    ...member,
    id: text(member.id),
    groupId: text(member.groupId || member.group_id),
    classId: text(member.classId || member.class_id),
    sortOrder: Number(member.sortOrder ?? member.sort_order ?? 0),
  };
}

function buildScheduleWarningText(row) {
  return (
    text(row?.warningSummary?.syncGap?.message) ||
    text(row?.warningSummary?.planDrift?.message)
  );
}

function isSessionCounted(session = {}) {
  const state = text(session?.scheduleState || session?.schedule_state);
  return !["exception", "tbd"].includes(state);
}

function normalizeEntryProgressStatus(entry = {}) {
  const status = text(entry?.actual?.status || entry?.status);
  if (status === "done" || status === "partial") {
    return status;
  }
  return "pending";
}

function hasEntryActualContent(entry = {}) {
  const actual = entry?.actual || {};
  return Boolean(
    text(actual.start) ||
      text(actual.end) ||
      text(actual.label) ||
      text(actual.publicNote || actual.public_note) ||
      text(actual.teacherNote || actual.teacher_note) ||
      (text(actual.status) && text(actual.status) !== "pending") ||
      text(actual.updatedAt || actual.updated_at),
  );
}

function normalizeLogProgressStatus(status) {
  const value = text(status);
  if (value === "done" || value === "partial") {
    return value;
  }
  return "pending";
}

function buildProgressLogNoteSummary(log = {}) {
  return [text(log?.range_label || log?.rangeLabel), text(log?.public_note || log?.publicNote), text(log?.teacher_note || log?.teacherNote)]
    .filter(Boolean)
    .join(" · ");
}

function buildProgressLogClassSummary(progressLogs = []) {
  const byClassId = new Map();

  for (const log of progressLogs || []) {
    const classId = text(log?.class_id || log?.classId);
    if (!classId) {
      continue;
    }

    const summary = byClassId.get(classId) || {
      bySessionId: new Map(),
      bySessionOrder: new Map(),
      bySessionAndTextbook: new Map(),
      bySessionOrderAndTextbook: new Map(),
      latestUpdatedAt: "",
      latestNoteSummary: "",
      latestNoteSessionLabel: "",
    };
    const sessionId = text(log?.session_id || log?.sessionId || log?.progress_key || log?.progressKey);
    const sessionOrder = Number(log?.session_order ?? log?.sessionOrder ?? 0) || 0;
    const textbookId = text(log?.textbook_id || log?.textbookId);
    const progressStatus = normalizeLogProgressStatus(log?.status);
    const updatedAt = text(log?.updated_at || log?.updatedAt || log?.date);
    const noteSummary = buildProgressLogNoteSummary(log);
    const rangeLabel = text(log?.range_label || log?.rangeLabel);
    const publicNote = text(log?.public_note || log?.publicNote);
    const teacherNote = text(log?.teacher_note || log?.teacherNote);
    const content = text(log?.content);
    const homework = text(log?.homework);
    const sessionLabel = sessionOrder > 0 ? `${sessionOrder}회차` : sessionId || "기록";
    const entry = {
      id: text(log?.id),
      sessionId,
      sessionOrder,
      textbookId,
      progressStatus,
      updatedAt,
      noteSummary,
      rangeLabel,
      publicNote,
      teacherNote,
      content,
      homework,
      sessionLabel,
      date: toDateKey(updatedAt),
      hasActualContent: progressStatus !== "pending" || Boolean(noteSummary || updatedAt || content || homework),
    };

    if (sessionId) {
      const current = summary.bySessionId.get(sessionId);
      if (!current || text(current.updatedAt) <= updatedAt) {
        summary.bySessionId.set(sessionId, entry);
      }
    }
    if (sessionOrder > 0) {
      const current = summary.bySessionOrder.get(sessionOrder);
      if (!current || text(current.updatedAt) <= updatedAt) {
        summary.bySessionOrder.set(sessionOrder, entry);
      }
    }
    if (sessionId && textbookId) {
      const current = summary.bySessionAndTextbook.get(`${sessionId}:${textbookId}`);
      if (!current || text(current.updatedAt) <= updatedAt) {
        summary.bySessionAndTextbook.set(`${sessionId}:${textbookId}`, entry);
      }
    }
    if (sessionOrder > 0 && textbookId) {
      const current = summary.bySessionOrderAndTextbook.get(`${sessionOrder}:${textbookId}`);
      if (!current || text(current.updatedAt) <= updatedAt) {
        summary.bySessionOrderAndTextbook.set(`${sessionOrder}:${textbookId}`, entry);
      }
    }
    if (updatedAt && (!summary.latestUpdatedAt || summary.latestUpdatedAt <= updatedAt)) {
      summary.latestUpdatedAt = updatedAt;
      summary.latestNoteSummary = noteSummary;
      summary.latestNoteSessionLabel = sessionLabel;
    }

    byClassId.set(classId, summary);
  }

  return byClassId;
}

function mergeSessionProgress(entryStatuses = [], logStatus = "") {
  const normalizedStatuses = entryStatuses
    .map((status) => normalizeLogProgressStatus(status))
    .filter(Boolean);
  const activeEntryStatuses = normalizedStatuses.filter((status) => status !== "pending");

  if (activeEntryStatuses.length === 0) {
    return logStatus || "pending";
  }
  if (normalizedStatuses.includes("pending")) {
    return "partial";
  }
  if (activeEntryStatuses.every((status) => status === "done")) {
    return "done";
  }
  return "partial";
}

function buildActualFromProgressLog(actual = {}, progressLog = null) {
  if (!progressLog) {
    return {
      ...actual,
      status: normalizeLogProgressStatus(actual?.status),
      updatedAt: text(actual?.updatedAt || actual?.updated_at),
    };
  }

  return {
    ...actual,
    status: normalizeLogProgressStatus(progressLog?.progressStatus || actual?.status),
    label: text(progressLog?.rangeLabel) || text(actual?.label),
    publicNote: text(progressLog?.publicNote) || text(actual?.publicNote || actual?.public_note),
    teacherNote: text(progressLog?.teacherNote) || text(actual?.teacherNote || actual?.teacher_note),
    updatedAt: text(progressLog?.updatedAt) || text(actual?.updatedAt || actual?.updated_at),
  };
}

function buildMergedTextbookEntries(textbookEntries = [], progressSummary = null, sessionId = "", sessionNumber = 0) {
  return (textbookEntries || []).map((entry) => {
    const textbookId = text(entry?.textbookId || entry?.textbook_id || entry?.id);
    const matchedLog =
      (sessionId && textbookId ? progressSummary?.bySessionAndTextbook?.get(`${sessionId}:${textbookId}`) : null) ||
      (sessionNumber > 0 && textbookId
        ? progressSummary?.bySessionOrderAndTextbook?.get(`${sessionNumber}:${textbookId}`)
        : null) ||
      null;
    const actual = buildActualFromProgressLog(entry?.actual || {}, matchedLog);

    return {
      ...entry,
      textbookId,
      actual,
    };
  });
}

function normalizeSessionScheduleMeta(session = {}) {
  return {
    memo: text(session?.memo || session?.session_memo),
    makeupDate: text(session?.makeupDate || session?.makeup_date),
    originalDate: text(session?.originalDate || session?.original_date),
  };
}

function buildFallbackSessions(classItem = {}, progressSummary = null) {
  const plan = classItem?.schedulePlan || classItem?.schedule_plan || null;
  const sessions = Array.isArray(plan?.sessions)
    ? plan.sessions
    : Array.isArray(plan?.session_list)
      ? plan.session_list
      : [];
  const mergedSessions = sessions
    .map((session) => {
      const textbookEntries = Array.isArray(session?.textbookEntries)
        ? session.textbookEntries
        : Array.isArray(session?.textbook_entries)
          ? session.textbook_entries
          : [];
      const sessionId = text(session?.id || session?.session_id);
      const sessionNumber = Number(session?.sessionNumber ?? session?.session_number ?? 0) || 0;
      const billingId = text(session?.billingId || session?.billing_id);
      const billingLabel = text(session?.billingLabel || session?.billing_label);
      const billingColor = text(session?.billingColor || session?.billing_color);
      const matchedLog =
        (sessionId ? progressSummary?.bySessionId?.get(sessionId) : null) ||
        (sessionNumber > 0 ? progressSummary?.bySessionOrder?.get(sessionNumber) : null) ||
        null;
      const scheduleMeta = normalizeSessionScheduleMeta(session);
      const mergedTextbookEntries = buildMergedTextbookEntries(
        textbookEntries,
        progressSummary,
        sessionId,
        sessionNumber,
      );
      const statuses = mergedTextbookEntries.map(normalizeEntryProgressStatus);
      const progressStatus = mergeSessionProgress(statuses, matchedLog?.progressStatus || "");
      const entryUpdatedAt = mergedTextbookEntries
        .map((entry) => text(entry?.actual?.updatedAt || entry?.actual?.updated_at))
        .filter(Boolean)
        .sort()
        .at(-1) || "";
      const updatedAt = [entryUpdatedAt, text(matchedLog?.updatedAt)].filter(Boolean).sort().at(-1) || "";
      const noteSummary = text(matchedLog?.noteSummary);
      const rangeLabel = text(matchedLog?.rangeLabel);
      const publicNote = text(matchedLog?.publicNote);
      const teacherNote = text(matchedLog?.teacherNote);
      const content = text(matchedLog?.content);
      const homework = text(matchedLog?.homework);
      const hasActualContent =
        mergedTextbookEntries.some(hasEntryActualContent) || Boolean(matchedLog?.hasActualContent);

      return {
        id: sessionId || text(matchedLog?.sessionId),
        billingId,
        billingLabel,
        billingColor,
        date: toDateKey(session?.date || session?.session_date || matchedLog?.date || updatedAt),
        sessionNumber,
        scheduleState: text(session?.scheduleState || session?.schedule_state || "active"),
        memo: scheduleMeta.memo,
        makeupDate: scheduleMeta.makeupDate,
        originalDate: scheduleMeta.originalDate,
        progressStatus,
        hasActualContent,
        updatedAt,
        noteSummary,
        rangeLabel,
        publicNote,
        teacherNote,
        content,
        homework,
        textbookEntries: mergedTextbookEntries,
      };
    });

  const plannedSessionKeys = new Set(
    mergedSessions.map((session) => `${text(session.id)}::${Number(session.sessionNumber || 0)}`),
  );
  const syntheticSessions = [...(progressSummary?.bySessionId?.values() || []), ...(progressSummary?.bySessionOrder?.values() || [])]
    .filter((session) => {
      const key = `${text(session.sessionId)}::${Number(session.sessionOrder || 0)}`;
      return !plannedSessionKeys.has(key);
    })
    .map((session) => ({
      id: text(session.sessionId || session.id),
      billingId: "",
      billingLabel: "",
      billingColor: "",
      date: toDateKey(session.date || session.updatedAt),
      sessionNumber: Number(session.sessionOrder || 0),
      scheduleState: "active",
      memo: "",
      makeupDate: "",
      originalDate: "",
      progressStatus: text(session.progressStatus) || "pending",
      hasActualContent: Boolean(session.hasActualContent),
      updatedAt: text(session.updatedAt),
      noteSummary: text(session.noteSummary),
      rangeLabel: text(session.rangeLabel),
      publicNote: text(session.publicNote),
      teacherNote: text(session.teacherNote),
      content: text(session.content),
      homework: text(session.homework),
      textbookEntries: [],
    }));

  return [...mergedSessions, ...syntheticSessions].sort((left, right) => {
    const sessionGap = Number(left.sessionNumber || 0) - Number(right.sessionNumber || 0);
    if (sessionGap !== 0) {
      return sessionGap;
    }
    return text(left.date).localeCompare(text(right.date));
  });
}

function buildFallbackRouteMetrics(classItem = {}, progressSummary = null, now = new Date()) {
  const today = formatDate(now);
  const sessions = buildFallbackSessions(classItem, progressSummary);
  const countedSessions = sessions.filter(isSessionCounted);
  const completedSessions = countedSessions.filter((session) => session.progressStatus === "done").length;
  const latestPlannedSessionIndex = countedSessions.reduce((maxValue, session) => {
    if (!session.date || (today && session.date <= today)) {
      return Math.max(maxValue, Number(session.sessionNumber || 0));
    }
    return maxValue;
  }, 0);
  const latestActualSessionIndex = countedSessions.reduce((maxValue, session) => {
    if (!session.hasActualContent && text(session.progressStatus) === "pending") {
      return maxValue;
    }
    return Math.max(maxValue, Number(session.sessionNumber || 0));
  }, 0);
  const gap = latestPlannedSessionIndex - latestActualSessionIndex;

  return {
    sessions,
    sessionCount: countedSessions.length,
    completedSessions,
    latestPlannedSessionIndex,
    latestActualSessionIndex,
    warningText:
      gap > 0
        ? `계획보다 ${gap}회차 지연`
        : gap < 0
          ? `계획보다 ${Math.abs(gap)}회차 앞섬`
          : "",
  };
}

function buildPlanDriftWarning(latestPlannedSessionIndex = 0, latestActualSessionIndex = 0) {
  const gap = Number(latestActualSessionIndex || 0) - Number(latestPlannedSessionIndex || 0);
  if (gap === 0) {
    return null;
  }

  return {
    sessions: Math.abs(gap),
    variant: gap < 0 ? "behind" : "ahead",
    message:
      gap < 0
        ? `계획보다 ${Math.abs(gap)}회차 지연`
        : `계획보다 ${Math.abs(gap)}회차 앞섬`,
  };
}

function buildSyncGapWarning(row, peers = []) {
  if (!row?.syncGroupId || peers.length <= 1) {
    return null;
  }

  const currentIndex = Number(row.latestActualSessionIndex || 0);
  const aheadPeer = peers.reduce((best, peer) => {
    if (text(peer?.classItem?.id) === text(row?.classItem?.id)) {
      return best;
    }

    const peerIndex = Number(peer.latestActualSessionIndex || 0);
    if (peerIndex <= currentIndex) {
      return best;
    }

    if (!best || peerIndex > Number(best.latestActualSessionIndex || 0)) {
      return peer;
    }

    return best;
  }, null);

  if (aheadPeer) {
    const sessions = Number(aheadPeer.latestActualSessionIndex || 0) - currentIndex;
    return {
      sessions,
      variant: "behind",
      message: `${text(row?.classItem?.name || row?.classItem?.className)}가 ${text(aheadPeer?.classItem?.name || aheadPeer?.classItem?.className)}보다 ${sessions}회차 뒤처짐`,
    };
  }

  const behindPeer = peers.reduce((best, peer) => {
    if (text(peer?.classItem?.id) === text(row?.classItem?.id)) {
      return best;
    }

    const peerIndex = Number(peer.latestActualSessionIndex || 0);
    if (peerIndex >= currentIndex) {
      return best;
    }

    if (!best || peerIndex < Number(best.latestActualSessionIndex || 0)) {
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
    message: `${text(row?.classItem?.name || row?.classItem?.className)}가 ${text(behindPeer?.classItem?.name || behindPeer?.classItem?.className)}보다 ${sessions}회차 앞섬`,
  };
}

function buildWorkspaceFilterOptions(rows = []) {
  const build = (values) =>
    [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, "ko"));
  const termMap = new Map();

  rows.forEach((row) => {
    const termId = text(row.term?.id || row.classItem?.termId || row.classItem?.term_id);
    const termName = text(row.term?.name);
    if (termId) {
      termMap.set(termId, termName || termId);
    }
  });

  return {
    terms: [...termMap.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label, "ko")),
    subjects: build(rows.map((row) => text(row.classItem?.subject))),
    grades: build(rows.map((row) => text(row.classItem?.grade))),
    teachers: build(rows.flatMap((row) => splitList(row.classItem?.teacher))),
  };
}

function buildSyncGroupCards(syncGroups = [], syncMembers = [], rows = [], classes = []) {
  const rowByClassId = new Map((rows || []).map((row) => [text(row?.classItem?.id), row]));
  const classById = new Map((classes || []).map((item) => [text(item?.id), item]));

  return (syncGroups || [])
    .map((group) => {
      const members = (syncMembers || [])
        .filter((member) => text(member?.groupId) === text(group?.id))
        .sort((left, right) => Number(left?.sortOrder || 0) - Number(right?.sortOrder || 0))
        .filter((member) => rowByClassId.has(text(member?.classId)))
        .map((member) => {
          const row = rowByClassId.get(text(member?.classId));
          const classItem = row?.classItem || classById.get(text(member?.classId)) || {};

          return {
            classId: text(member?.classId),
            className: text(classItem.className || classItem.name || member?.classId),
          };
        });

      const warningMessages = members
        .map((member) => rowByClassId.get(text(member?.classId))?.warningSummary?.syncGap?.message || "")
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

function buildClassScheduleWorkspaceData({
  classes = [],
  classTerms = [],
  progressLogs = [],
  syncGroups = [],
  syncGroupMembers = [],
  filters = {},
  now = new Date(),
} = {}) {
  const normalizedFilters = {
    termId: text(filters.termId),
    subject: text(filters.subject),
    grade: text(filters.grade),
    teacher: text(filters.teacher),
  };
  const termsById = new Map((classTerms || []).map((term) => [text(term.id), term]));
  const normalizedSyncGroups = (syncGroups || []).map(normalizeSyncGroup);
  const normalizedSyncMembers = (syncGroupMembers || []).map(normalizeSyncGroupMember);
  const groupsById = new Map(normalizedSyncGroups.map((group) => [group.id, group]));
  const membershipByClassId = new Map(
    normalizedSyncMembers.map((member) => [text(member.classId), member]),
  );
  const progressSummaryByClass = buildProgressLogClassSummary(progressLogs);
  const errors = [];

  const rows = (classes || [])
    .filter((classItem) => {
      const termId = text(classItem.termId || classItem.term_id);
      if (normalizedFilters.termId && normalizedFilters.termId !== termId) {
        return false;
      }
      if (normalizedFilters.subject && normalizedFilters.subject !== text(classItem.subject)) {
        return false;
      }
      if (normalizedFilters.grade && normalizedFilters.grade !== text(classItem.grade)) {
        return false;
      }
      if (
        normalizedFilters.teacher &&
        !splitList(classItem.teacher).includes(normalizedFilters.teacher)
      ) {
        return false;
      }
      return true;
    })
    .flatMap((classItem) => {
      try {
        const progressSummary = progressSummaryByClass.get(text(classItem.id)) || null;
        const fallback = buildFallbackRouteMetrics(classItem, progressSummary, now);
        const membership = membershipByClassId.get(text(classItem.id)) || null;
        const syncGroup = membership ? groupsById.get(text(membership.groupId)) || null : null;

        return [
          {
            classItem,
            term: termsById.get(text(classItem.termId || classItem.term_id)) || null,
            syncGroupId: text(syncGroup?.id),
            syncGroup,
            syncMembership: membership,
            sessions: fallback.sessions,
            latestPlannedSessionIndex: fallback.latestPlannedSessionIndex,
            latestActualSessionIndex: fallback.latestActualSessionIndex,
            latestNoteSummary: text(progressSummary?.latestNoteSummary),
            latestNoteSessionLabel: text(progressSummary?.latestNoteSessionLabel),
            warningSummary: {
              planDrift: buildPlanDriftWarning(
                fallback.latestPlannedSessionIndex,
                fallback.latestActualSessionIndex,
              ),
              syncGap: null,
            },
          },
        ];
      } catch (error) {
        errors.push({
          classId: text(classItem?.id),
          className: text(classItem?.className || classItem?.name),
          message: text(error?.message || error),
        });
        return [];
      }
    });

  const rowsByGroup = rows.reduce((result, row) => {
    if (!row.syncGroupId) {
      return result;
    }

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
    (row.sessions || []).map((session) => text(session.date)).filter(Boolean),
  );

  return {
    rows: nextRows,
    errors,
    syncGroups: normalizedSyncGroups,
    syncGroupMembers: normalizedSyncMembers,
    timelineRange: {
      start: sessionDates.length > 0 ? sessionDates.slice().sort()[0] : "",
      end: sessionDates.length > 0 ? sessionDates.slice().sort().at(-1) : "",
    },
  };
}

function buildRouteRows(rows = []) {
  return rows.map((row) => {
    const fallback = buildFallbackRouteMetrics(row?.classItem);
    const sessions = (row.sessions || []).length > 0 ? row.sessions : fallback.sessions;
    const completedSessions = sessions.filter(
      (session) => text(session.progressStatus) === "done",
    ).length;
    const sortedSessions = [...sessions].sort(
      (left, right) => Number(left?.sessionNumber || 0) - Number(right?.sessionNumber || 0),
    );
    const nextActionSession =
      sortedSessions.find((session) => text(session.progressStatus) !== "done") || null;

    return {
      id: text(row?.classItem?.id),
      title: text(row?.classItem?.className || row?.classItem?.name),
      subject: text(row?.classItem?.subject),
      grade: text(row?.classItem?.grade),
      teacher: text(row?.classItem?.teacher),
      termName: text(row?.term?.name),
      scheduleLabel: text(row?.classItem?.schedule),
      sessionCount: sessions.length || fallback.sessionCount,
      completedSessions,
      latestPlannedSessionIndex: Number(
        row.latestPlannedSessionIndex || fallback.latestPlannedSessionIndex || 0,
      ),
      latestActualSessionIndex: Number(
        row.latestActualSessionIndex || fallback.latestActualSessionIndex || 0,
      ),
      nextActionSessionId: text(nextActionSession?.id),
      syncGroupName: text(row?.syncGroup?.name),
      warningText: buildScheduleWarningText(row) || fallback.warningText,
      raw: row,
    };
  });
}

function buildRouteSummary(rows = []) {
  return rows.reduce(
    (accumulator, row) => {
      accumulator.classCount += 1;
      accumulator.totalSessions += Number(row.sessionCount || 0);
      accumulator.completedSessions += Number(row.completedSessions || 0);
      if (row.warningText) {
        accumulator.warningCount += 1;
      }
      return accumulator;
    },
    {
      classCount: 0,
      totalSessions: 0,
      completedSessions: 0,
      warningCount: 0,
    },
  );
}

export function buildClassScheduleRouteModel({
  classes = [],
  textbooks = [],
  progressLogs = [],
  classTerms = [],
  syncGroups = [],
  syncGroupMembers = [],
  filters = {},
} = {}) {
  void textbooks;

  const workspaceData = buildClassScheduleWorkspaceData({
    classes,
    classTerms,
    progressLogs,
    syncGroups,
    syncGroupMembers,
    filters,
  });
  const searchKeyword = text(filters.search).toLowerCase();
  const selectedSyncGroupId = text(filters.selectedSyncGroupId);
  const routeRows = buildRouteRows(workspaceData.rows)
    .filter((row) => {
      if (selectedSyncGroupId && text(row.raw?.syncGroupId) !== selectedSyncGroupId) {
        return false;
      }
      if (!searchKeyword) {
        return true;
      }
      const haystack = [row.title, row.subject, row.grade, row.teacher, row.termName, row.scheduleLabel]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(searchKeyword);
    })
    .sort((left, right) => left.title.localeCompare(right.title, "ko"));

  const visibleWorkspaceRows = routeRows.map((row) => row.raw);

  return {
    rows: routeRows,
    filterOptions: buildWorkspaceFilterOptions(workspaceData.rows),
    syncGroupCards: buildSyncGroupCards(
      workspaceData.syncGroups,
      workspaceData.syncGroupMembers,
      visibleWorkspaceRows,
      classes,
    ),
    summary: buildRouteSummary(routeRows),
    timelineRange: workspaceData.timelineRange,
    errors: workspaceData.errors || [],
  };
}
