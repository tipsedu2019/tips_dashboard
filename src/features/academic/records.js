import {
  ACTIVE_CLASS_STATUS,
  computeClassStatus,
  ENDED_CLASS_STATUS,
  normalizeClassStatus,
  PREPARING_CLASS_STATUS,
} from "../../lib/class-status.js";

const DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];
const DAY_INDEX = Object.fromEntries(
  DAY_ORDER.map((day, index) => [day, index]),
);
const CLASSROOM_HINT_PATTERN = /(강의실|교실|랩|홀|센터|스튜디오|room|본관|별관)/i;
const SHORT_CLASSROOM_TOKEN_PATTERN = /^(본|별)\s*\d+(?:강)?$/i;
const NUMBERED_CLASSROOM_TOKEN_PATTERN = /^\d+(?:강|실|관)$/;
const CLASSROOM_ALIAS_MAP = new Map([
  ["본2", "본관 2강"],
  ["본2강", "본관 2강"],
  ["본3", "본관 3강"],
  ["본3강", "본관 3강"],
  ["본5", "본관 5강"],
  ["본5강", "본관 5강"],
  ["별3", "별관 3강"],
  ["별3강", "별관 3강"],
  ["별5", "별관 5강"],
  ["별5강", "별관 5강"],
  ["별7", "별관 5강"],
  ["별7강", "별관 5강"],
]);

function text(value) {
  return String(value || "").trim();
}

function normalizePeriodLabel(value) {
  return text(value)
    .replace(/\b(20\d{2})\s+\1(?=\s|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPeriodLabel(academicYear, term) {
  const year = normalizePeriodLabel(academicYear);
  const termLabel = normalizePeriodLabel(term);
  if (!termLabel) {
    return year;
  }

  if (year && termLabel.includes(year)) {
    return termLabel;
  }

  return normalizePeriodLabel([year, termLabel].filter(Boolean).join(" "));
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeList(value) {
  return text(value)
    .split(/[,/&·\n]+/)
    .map((item) => text(item))
    .filter(Boolean);
}

export function splitTeacherList(value) {
  return normalizeList(value);
}

export function splitClassroomList(value) {
  return normalizeList(value).map((item) => normalizeTimetableClassroomName(item));
}

export function normalizeTimetableClassroomName(value) {
  const raw = text(value);
  if (!raw) {
    return "";
  }

  const compact = raw.replace(/\s+/g, "");
  return CLASSROOM_ALIAS_MAP.get(compact) || raw;
}

export function stripClassPrefix(value) {
  return text(value).replace(/^\[[^\]]+\]\s*/, "");
}

function timeToMinutes(value) {
  const [hour, minute] = text(value).split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return 0;
  }

  return hour * 60 + minute;
}

function isClassroomToken(token) {
  const normalized = text(token).replace(/\s+/g, "");
  return (
    CLASSROOM_HINT_PATTERN.test(text(token)) ||
    SHORT_CLASSROOM_TOKEN_PATTERN.test(normalized) ||
    NUMBERED_CLASSROOM_TOKEN_PATTERN.test(normalized)
  );
}

function parseOverride(override) {
  const parts = normalizeList(override);
  if (parts.length === 0) {
    return { teacher: "", classroom: "" };
  }

  if (parts.length === 1) {
    return isClassroomToken(parts[0])
      ? { teacher: "", classroom: normalizeTimetableClassroomName(parts[0]) }
      : { teacher: parts[0], classroom: "" };
  }

  const teacher = parts.find((part) => !isClassroomToken(part)) || "";
  const classroom = normalizeTimetableClassroomName(
    parts.find((part) => isClassroomToken(part)) || "",
  );

  return { teacher, classroom };
}

export function parseAcademicSchedule(schedule, classItem = {}) {
  const input = text(schedule).replace(/\r\n/g, "\n");
  if (!input) {
    return [];
  }

  const defaultTeacher = splitTeacherList(classItem.teacher)[0] || "";
  const defaultClassroom =
    splitClassroomList(classItem.classroom || classItem.room)[0] || "";
  const slots = [];
  const pattern =
    /([월화수목금토일]+)\s*([0-9]{1,2}:\d{2})\s*-\s*([0-9]{1,2}:\d{2})(?:\s*\(([^)]+)\))?/g;

  let match = pattern.exec(input);
  while (match) {
    const [, days, start, end, override] = match;
    const parsedOverride = parseOverride(override);

    for (const day of text(days)) {
      if (!(day in DAY_INDEX)) {
        continue;
      }

      slots.push({
        day,
        start,
        end,
        teacher: parsedOverride.teacher || defaultTeacher,
        classroom: parsedOverride.classroom || defaultClassroom,
      });
    }

    match = pattern.exec(input);
  }

  return slots;
}

function getClassStatus(classItem) {
  return normalizeClassStatus(classItem?.status) || computeClassStatus(classItem);
}

function getClassTermName(classItem, classTerms = []) {
  const period = text(classItem?.period);
  if (period) {
    return period;
  }

  const termId = text(classItem?.term_id || classItem?.termId);
  if (!termId) {
    return "";
  }

  const matched = (classTerms || []).find(
    (term) => text(term?.id) === termId,
  );

  return text(matched?.name || matched?.period);
}

function getClassAcademicYear(classItem, classTerms = []) {
  const directYear = text(
    classItem?.academic_year ||
      classItem?.academicYear ||
      classItem?.year ||
      classItem?.school_year ||
      classItem?.schoolYear,
  );
  if (directYear) {
    return directYear;
  }

  const termId = text(classItem?.term_id || classItem?.termId);
  const matchedTerm = termId
    ? (classTerms || []).find((term) => text(term?.id) === termId)
    : null;
  const termYear = text(
    matchedTerm?.academic_year ||
      matchedTerm?.academicYear ||
      matchedTerm?.year ||
      matchedTerm?.school_year ||
      matchedTerm?.schoolYear,
  );
  if (termYear) {
    return termYear;
  }

  const termLabelMatch = getClassTermName(classItem, classTerms).match(/20\d{2}/);
  return termLabelMatch ? termLabelMatch[0] : String(new Date().getFullYear());
}

function getClassStatusFilterLabel(value) {
  const status = normalizeClassStatus(value) || text(value);
  if (status === ENDED_CLASS_STATUS || status.includes("종강") || status.toLowerCase() === "ended") {
    return "종강";
  }
  if (
    status === PREPARING_CLASS_STATUS ||
    status.includes("준비") ||
    status.includes("예정") ||
    status.toLowerCase() === "preparing"
  ) {
    return "개강 준비";
  }
  return "수강";
}

function normalizeClassGroup(group = {}) {
  const id = text(group?.id);
  const rawName = text(group?.name);
  const name = normalizePeriodLabel(rawName) || id;
  if (!id && !name) {
    return null;
  }

  return {
    id: id || name,
    name,
    rawName,
    subject: text(group?.subject),
    sortOrder: Number(group?.sort_order ?? group?.sortOrder ?? 0) || 0,
    synthetic: Boolean(group?.synthetic),
  };
}

function normalizeClassGroupMember(member = {}) {
  const groupId = text(member?.group_id || member?.groupId);
  const classId = text(member?.class_id || member?.classId);
  if (!groupId || !classId) {
    return null;
  }

  return {
    groupId,
    classId,
    sortOrder: Number(member?.sort_order ?? member?.sortOrder ?? 0) || 0,
  };
}

function buildFallbackClassGroup(classItem, classTerms = []) {
  const academicYear = getClassAcademicYear(classItem, classTerms);
  const term = getClassTermName(classItem, classTerms);
  const name = buildPeriodLabel(academicYear, term);
  if (!name) {
    return null;
  }

  return {
    id: `term:${academicYear || "year"}:${term || "term"}`,
    name,
    subject: text(classItem?.subject),
    sortOrder: 100000,
    synthetic: true,
  };
}

function getClassGroupOptionKey(group = {}) {
  return normalizePeriodLabel(group?.name) || text(group?.id);
}

function compareClassGroups(left = {}, right = {}) {
  const syntheticGap = Number(Boolean(left.synthetic)) - Number(Boolean(right.synthetic));
  if (syntheticGap !== 0) {
    return syntheticGap;
  }

  const sortGap = Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
  if (sortGap !== 0) {
    return sortGap;
  }

  const nameGap = text(left.name).localeCompare(text(right.name), "ko", { numeric: true });
  if (nameGap !== 0) {
    return nameGap;
  }

  return text(left.id).localeCompare(text(right.id), "ko", { numeric: true });
}

function buildClassGroupOptions(groups = []) {
  const byKey = new Map();

  for (const group of [...groups].filter(Boolean).sort(compareClassGroups)) {
    const key = getClassGroupOptionKey(group);
    if (!key) {
      continue;
    }

    const id = text(group.id);
    const rawName = text(group.rawName || group.name);
    const name = normalizePeriodLabel(group.name);
    const existing = byKey.get(key);
    if (existing) {
      existing.aliases = unique([...existing.aliases, id, rawName, name]);
      continue;
    }

    byKey.set(key, {
      value: id || name,
      label: name || id,
      sortOrder: Number(group.sortOrder || 0),
      aliases: unique([id, rawName, name]),
    });
  }

  return [...byKey.values()]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, "ko", { numeric: true }))
    .map(({ value, label, aliases }) => ({ value, label, aliases }));
}

function getClassGroupFilterValues(classGroupOptions = [], selectedGroup = "") {
  const selected = text(selectedGroup);
  if (!selected) {
    return [];
  }

  const option = classGroupOptions.find((item) => {
    const aliases = toArray(item?.aliases).map((alias) => text(alias));
    return item.value === selected || item.label === selected || aliases.includes(selected);
  });

  return option ? option.aliases : [selected];
}

function rowMatchesClassGroup(row, filterValues = []) {
  if (filterValues.length === 0) {
    return true;
  }

  return filterValues.some(
    (value) => row.classGroupIds.includes(value) || row.classGroupNames.includes(value),
  );
}

function buildClassGroupContext(classes = [], classTerms = [], classGroups = [], classGroupMembers = []) {
  const explicitGroups = toArray(classGroups)
    .map(normalizeClassGroup)
    .filter(Boolean);
  const groupsById = new Map(explicitGroups.map((group) => [group.id, group]));
  const membersByClassId = toArray(classGroupMembers).reduce((result, member) => {
    const normalized = normalizeClassGroupMember(member);
    if (!normalized) {
      return result;
    }
    const list = result.get(normalized.classId) || [];
    list.push(normalized);
    result.set(normalized.classId, list);
    return result;
  }, new Map());
  const groupsByClassId = new Map();
  const optionById = new Map(explicitGroups.map((group) => [group.id, group]));

  for (const classItem of toArray(classes)) {
    const classId = text(classItem?.id);
    if (!classId) {
      continue;
    }

    const matchedGroups = (membersByClassId.get(classId) || [])
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((member) => groupsById.get(member.groupId))
      .filter(Boolean);
    const classGroupsForClass =
      matchedGroups.length > 0
        ? matchedGroups
        : [buildFallbackClassGroup(classItem, classTerms)].filter(Boolean);

    for (const group of classGroupsForClass) {
      if (!optionById.has(group.id)) {
        optionById.set(group.id, group);
      }
    }
    groupsByClassId.set(classId, classGroupsForClass);
  }

  const classGroupOptions = buildClassGroupOptions([...optionById.values()]);

  return { groupsByClassId, classGroupOptions };
}

function getClassTextbookIds(classItem) {
  return unique(
    toArray(classItem?.textbook_ids || classItem?.textbookIds).map((value) =>
      text(value),
    ),
  );
}

function buildSearchText(parts = []) {
  return parts
    .map((part) => text(part))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getProgressStatus(entry = {}) {
  const explicit = text(entry?.progressStatus || entry?.progress_status);
  if (explicit) {
    return explicit;
  }

  const actualStatuses = toArray(entry?.textbookEntries)
    .map((item) => text(item?.actual?.status))
    .filter(Boolean);

  if (actualStatuses.length === 0) {
    return "pending";
  }
  if (actualStatuses.every((status) => status === "done")) {
    return "done";
  }
  if (actualStatuses.every((status) => status === "pending")) {
    return "pending";
  }
  return "partial";
}

function getLastUpdatedFromEntries(entries = []) {
  const dates = toArray(entries)
    .flatMap((entry) =>
      toArray(entry?.textbookEntries).map((item) =>
        text(item?.actual?.updatedAt || item?.actual?.updated_at),
      ),
    )
    .filter(Boolean)
    .sort();

  return dates[dates.length - 1] || "";
}

function normalizeProgressStatus(value) {
  const status = text(value);
  if (status === "done" || status === "partial") {
    return status;
  }
  return "pending";
}

function buildProgressLogNoteSummary(log = {}) {
  return [
    text(log?.range_label || log?.rangeLabel),
    text(log?.public_note || log?.publicNote),
    text(log?.teacher_note || log?.teacherNote),
  ]
    .filter(Boolean)
    .join(" · ");
}

function buildProgressLogSummary(progressLogs = []) {
  const byClassId = new Map();

  for (const log of progressLogs || []) {
    const classId = text(log?.class_id || log?.classId);
    if (!classId) {
      continue;
    }

    const existing = byClassId.get(classId) || {
      bySessionId: new Map(),
      bySessionOrder: new Map(),
      syntheticSessions: [],
      lastUpdatedAt: "",
      latestNoteSummary: "",
      latestNoteSessionLabel: "",
    };
    const sessionId =
      text(log?.session_id || log?.sessionId) ||
      text(log?.progress_key || log?.progressKey);
    const sessionOrder = Number(log?.session_order ?? log?.sessionOrder ?? 0) || 0;
    const progressStatus = normalizeProgressStatus(log?.status);
    const updatedAt = text(log?.updated_at || log?.updatedAt || log?.date);
    const noteSummary = buildProgressLogNoteSummary(log);
    const sessionLabel = sessionOrder > 0 ? `${sessionOrder}회차` : sessionId || "기록 회차";
    const sessionEntry = {
      sessionId,
      sessionOrder,
      progressStatus,
      updatedAt,
      noteSummary,
      sessionLabel,
      hasActualContent: progressStatus !== "pending" || Boolean(noteSummary || updatedAt),
    };

    if (sessionId) {
      const current = existing.bySessionId.get(sessionId);
      if (!current || text(current.updatedAt) <= updatedAt) {
        existing.bySessionId.set(sessionId, sessionEntry);
      }
    }

    if (sessionOrder > 0) {
      const current = existing.bySessionOrder.get(sessionOrder);
      if (!current || text(current.updatedAt) <= updatedAt) {
        existing.bySessionOrder.set(sessionOrder, sessionEntry);
      }
    }

    if (!sessionId && sessionOrder === 0) {
      existing.syntheticSessions.push(sessionEntry);
    }

    if (updatedAt && (!existing.lastUpdatedAt || existing.lastUpdatedAt <= updatedAt)) {
      existing.lastUpdatedAt = updatedAt;
      existing.latestNoteSummary = noteSummary;
      existing.latestNoteSessionLabel = sessionLabel;
    }

    byClassId.set(classId, existing);
  }

  return byClassId;
}

function getPlanSessions(classItem) {
  const plan = classItem?.schedulePlan || classItem?.schedule_plan;
  return toArray(plan?.sessions);
}

function createTimetableRow(classItem, classTerms, slot, classGroupsForClass = []) {
  const title = stripClassPrefix(classItem?.className || classItem?.name) || text(classItem?.name);
  const status = getClassStatus(classItem);
  const classGroupIds = toArray(classGroupsForClass).map((group) => text(group?.id)).filter(Boolean);
  const classGroupNames = toArray(classGroupsForClass).map((group) => text(group?.name)).filter(Boolean);
  const teacher =
    text(slot?.teacher) || splitTeacherList(classItem?.teacher).join(", ");
  const classroom =
    normalizeTimetableClassroomName(text(slot?.classroom)) ||
    splitClassroomList(classItem?.classroom || classItem?.room).join(", ");
  return {

    id: `${text(classItem?.id)}:${slot.day}:${slot.start}:${slot.end}`,
    classId: text(classItem?.id),
    title,
    fullTitle: text(classItem?.className || classItem?.name),
    academicYear: getClassAcademicYear(classItem, classTerms),
    subject: text(classItem?.subject),
    grade: text(classItem?.grade),
    teacher,
    classroom,
    term: getClassTermName(classItem, classTerms),
    schedule: text(classItem?.schedule),
    status,
    statusFilter: getClassStatusFilterLabel(status),
    classGroupIds,
    classGroupNames,
    classGroupLabel: classGroupNames.join(", ") || "미분류",
    day: slot.day,
    dayIndex: DAY_INDEX[slot.day],
    start: slot.start,
    end: slot.end,
    startMinutes: timeToMinutes(slot.start),
    endMinutes: timeToMinutes(slot.end),
    durationMinutes: Math.max(
      0,
      timeToMinutes(slot.end) - timeToMinutes(slot.start),
    ),
    searchText: buildSearchText([
      title,
      classItem?.className,
      classItem?.subject,
      classItem?.grade,
      teacher,
      classroom,
      classGroupNames.join(" "),
      getClassStatusFilterLabel(status),
      getClassTermName(classItem, classTerms),
      classItem?.schedule,
    ]),
  };
}

function createCurriculumSessionSummaries(classItem, progressSummary) {
  const sessions = getPlanSessions(classItem);
  const activeSessions = sessions.filter((session) => {
    const scheduleState =
      text(session?.scheduleState || session?.schedule_state || session?.state) || "active";
    return scheduleState !== "exception" && scheduleState !== "tbd";
  });

  const plannedSummaries = activeSessions.map((session) => {
    const sessionId = text(session?.id);
    const sessionNumber = Number(session?.sessionNumber ?? session?.session_number ?? 0) || 0;
    const matchedLog =
      (sessionId ? progressSummary?.bySessionId?.get(sessionId) : null) ||
      (sessionNumber > 0 ? progressSummary?.bySessionOrder?.get(sessionNumber) : null) ||
      null;
    const planStatus = normalizeProgressStatus(getProgressStatus(session));
    const logStatus = normalizeProgressStatus(matchedLog?.progressStatus);
    const progressStatus =
      logStatus !== "pending"
        ? logStatus
        : planStatus;
    const entryUpdatedAt = getLastUpdatedFromEntries([session]);
    const updatedAt = [entryUpdatedAt, text(matchedLog?.updatedAt)].filter(Boolean).sort().slice(-1)[0] || "";
    const noteSummary = text(matchedLog?.noteSummary);
    const hasActualContent =
      planStatus !== "pending" || Boolean(matchedLog?.hasActualContent);

    return {
      id: sessionId || text(matchedLog?.sessionId) || `${sessionNumber}`,
      sessionNumber,
      label: sessionNumber > 0 ? `${sessionNumber}회차` : sessionId || "기록 회차",
      progressStatus,
      hasActualContent,
      updatedAt,
      noteSummary,
    };
  });

  const plannedKeys = new Set(
    plannedSummaries.map(
      (session) => `${text(session.id)}::${Number(session.sessionNumber || 0)}`,
    ),
  );

  const syntheticSeenKeys = new Set();
  const syntheticSummaries = [
    ...(progressSummary?.bySessionId?.values() || []),
    ...(progressSummary?.bySessionOrder?.values() || []),
    ...(progressSummary?.syntheticSessions || []),
  ]
    .filter((session) => {
      const key = `${text(session?.sessionId)}::${Number(session?.sessionOrder || 0)}`;
      if (plannedKeys.has(key) || syntheticSeenKeys.has(key)) {
        return false;
      }
      syntheticSeenKeys.add(key);
      return true;
    })
    .map((session) => ({
      id: text(session?.sessionId) || `${Number(session?.sessionOrder || 0)}`,
      sessionNumber: Number(session?.sessionOrder || 0),
      label:
        Number(session?.sessionOrder || 0) > 0
          ? `${Number(session?.sessionOrder || 0)}회차`
          : text(session?.sessionId) || text(session?.sessionLabel) || "기록 회차",
      progressStatus: normalizeProgressStatus(session?.progressStatus),
      hasActualContent: Boolean(session?.hasActualContent),
      updatedAt: text(session?.updatedAt),
      noteSummary: text(session?.noteSummary),
    }));

  return [...plannedSummaries, ...syntheticSummaries].sort((left, right) => {
    const sessionGap = Number(left.sessionNumber || 0) - Number(right.sessionNumber || 0);
    if (sessionGap !== 0) {
      return sessionGap;
    }
    return text(left.updatedAt).localeCompare(text(right.updatedAt));
  });
}

function createCurriculumRow(classItem, classTerms, textbooks, progressSummaryByClass, classGroupsForClass = []) {
  const id = text(classItem?.id);
  const title = stripClassPrefix(classItem?.className || classItem?.name) || text(classItem?.name);
  const term = getClassTermName(classItem, classTerms);
  const teacherNames = splitTeacherList(classItem?.teacher);
  const classroomNames = splitClassroomList(classItem?.classroom || classItem?.room);
  const classGroupIds = toArray(classGroupsForClass).map((group) => text(group?.id)).filter(Boolean);
  const classGroupNames = toArray(classGroupsForClass).map((group) => text(group?.name)).filter(Boolean);
  const textbookIds = getClassTextbookIds(classItem);
  const textbookSet = new Set(textbooks.map((book) => text(book?.id)));
  const textbookCount = textbookIds.filter((bookId) => textbookSet.has(bookId)).length || textbookIds.length;
  const status = getClassStatus(classItem);
  const statusFilter = getClassStatusFilterLabel(status);
  const progressSummary = progressSummaryByClass.get(id);
  const sessionSummaries = createCurriculumSessionSummaries(classItem, progressSummary);
  const totalSessions = sessionSummaries.length;
  const completedSessions = sessionSummaries.filter(
    (session) => session.progressStatus === "done",
  ).length;
  const updatedSessions = sessionSummaries.filter(
    (session) => session.progressStatus !== "pending",
  ).length;
  const delayedSessions = Math.max(totalSessions - updatedSessions, 0);
  const lastUpdatedAt = sessionSummaries
    .map((session) => text(session.updatedAt))
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || "";
  const latestNotedSession = [...sessionSummaries]
    .filter((session) => text(session.noteSummary))
    .sort((left, right) => text(left.updatedAt).localeCompare(text(right.updatedAt)))
    .slice(-1)[0] || null;
  const latestNoteSummary =
    text(latestNotedSession?.noteSummary) || text(progressSummary?.latestNoteSummary);
  const latestNoteSessionLabel =
    text(latestNotedSession?.label) || text(progressSummary?.latestNoteSessionLabel);
  const pendingSessionLabels = sessionSummaries
    .filter((session) => session.progressStatus === "pending")
    .map((session) => session.label)
    .filter(Boolean);

  const stateLabel =
    totalSessions === 0
      ? "계획 미설정"
      : delayedSessions > 0
        ? "업데이트 필요"
        : completedSessions === totalSessions
          ? "완료"
          : "진행 중";

  return {
    id,
    title,
    fullTitle: text(classItem?.className || classItem?.name),
    subject: text(classItem?.subject),
    grade: text(classItem?.grade),
    term,
    teacherNames,
    teacherSummary: teacherNames.join(", "),
    classroomNames,
    classroomSummary: classroomNames.join(", "),
    schedule: text(classItem?.schedule),
    status,
    statusFilter,
    classGroupIds,
    classGroupNames,
    classGroupLabel: classGroupNames.join(", ") || "미분류",
    textbookCount,
    totalSessions,
    completedSessions,
    updatedSessions,
    delayedSessions,
    progressPercent:
      totalSessions > 0 ? Math.round((updatedSessions / totalSessions) * 100) : 0,
    lastUpdatedAt,
    stateLabel,
    latestNoteSummary,
    latestNoteSessionLabel,
    pendingSessionLabels,
    sessionSummaries,
    searchText: buildSearchText([
      title,
      classItem?.className,
      classItem?.subject,
      classItem?.grade,
      term,
      teacherNames.join(" "),
      classroomNames.join(" "),
      classGroupNames.join(" "),
      statusFilter,
      classItem?.schedule,
    ]),
  };
}

function sortTimetableRows(rows = []) {
  return [...rows].sort((left, right) => {
    const dayGap = Number(left.dayIndex) - Number(right.dayIndex);
    if (dayGap !== 0) {
      return dayGap;
    }

    const startGap = Number(left.startMinutes) - Number(right.startMinutes);
    if (startGap !== 0) {
      return startGap;
    }

    return left.title.localeCompare(right.title, "ko");
  });
}

function sortCurriculumRows(rows = []) {
  return [...rows].sort((left, right) => {
    if (left.term !== right.term) {
      return left.term.localeCompare(right.term, "ko");
    }

    return left.title.localeCompare(right.title, "ko");
  });
}

function matchesFilter(value, filterValue) {
  const current = text(value);
  const selected = text(filterValue);
  return !selected || current === selected;
}

function matchesSearch(searchText, query) {
  const keyword = text(query).toLowerCase();
  if (!keyword) {
    return true;
  }

  return text(searchText).toLowerCase().includes(keyword);
}

function buildTeacherLoad(rows = []) {
  return Object.entries(
    rows.reduce((accumulator, row) => {
      const key = row.teacher || "미지정";
      const current = accumulator[key] || { name: key, minutes: 0, count: 0 };
      current.minutes += Number(row.durationMinutes || 0);
      current.count += 1;
      accumulator[key] = current;
      return accumulator;
    }, {}),
  )
    .map(([, value]) => value)
    .sort((left, right) => right.minutes - left.minutes)
    .slice(0, 5);
}

function buildClassroomLoad(rows = []) {
  return Object.entries(
    rows.reduce((accumulator, row) => {
      const key = row.classroom || "미지정";
      const current = accumulator[key] || { name: key, minutes: 0, count: 0 };
      current.minutes += Number(row.durationMinutes || 0);
      current.count += 1;
      accumulator[key] = current;
      return accumulator;
    }, {}),
  )
    .map(([, value]) => value)
    .sort((left, right) => right.minutes - left.minutes)
    .slice(0, 5);
}

function matchesSubjectCatalog(subjects = [], currentSubject = "") {
  const target = text(currentSubject);
  if (!target || target === "전체") {
    return true;
  }
  const normalizedSubjects = toArray(subjects).map((subject) => text(subject)).filter(Boolean);
  return normalizedSubjects.length === 0 || normalizedSubjects.includes(target);
}

function buildCatalogBackedOptions(catalogs = [], currentSubject = "", fallbackOptions = [], normalizer = text) {
  const visibleCatalogOptions = toArray(catalogs)
    .filter((item) => item?.is_visible !== false && matchesSubjectCatalog(item?.subjects, currentSubject))
    .sort((left, right) => Number(left?.sort_order || left?.sortOrder || 0) - Number(right?.sort_order || right?.sortOrder || 0) || text(left?.name).localeCompare(text(right?.name), "ko"))
    .map((item) => normalizer(item?.name))
    .filter(Boolean);

  const fallback = toArray(fallbackOptions).map((value) => normalizer(value)).filter(Boolean);
  return unique([...visibleCatalogOptions, ...fallback]);
}

function buildOrderedTermOptions(classTerms = [], rowTerms = []) {
  const orderedTerms = toArray(classTerms)
    .sort((left, right) => Number(left?.sort_order || left?.sortOrder || 0) - Number(right?.sort_order || right?.sortOrder || 0) || text(left?.name || left?.period).localeCompare(text(right?.name || right?.period), "ko"))
    .map((term) => text(term?.name || term?.period))
    .filter(Boolean);

  return unique([...orderedTerms, ...toArray(rowTerms).map((term) => text(term)).filter(Boolean)]);
}

function buildTimetableOptions(classes, classTerms, rows, teacherCatalogs = [], classroomCatalogs = [], currentSubject = "", classGroupOptions = []) {
  return {
    yearOptions: unique(rows.map((row) => text(row.academicYear)).filter(Boolean)).sort((left, right) => left.localeCompare(right, "ko")),
    termOptions: buildOrderedTermOptions(
      classTerms,
      classes.map((classItem) => getClassTermName(classItem, classTerms)).filter(Boolean),
    ),
    subjectOptions: unique(classes.map((classItem) => text(classItem?.subject))).sort(
      (left, right) => left.localeCompare(right, "ko"),
    ),
    classGroupOptions,
    statusOptions: ["수강", "개강 준비", "종강"],
    gradeOptions: unique(classes.map((classItem) => text(classItem?.grade))).sort(
      (left, right) => left.localeCompare(right, "ko"),
    ),
    teacherOptions: buildCatalogBackedOptions(
      teacherCatalogs,
      currentSubject,
      rows.map((row) => row.teacher).filter((value) => value && !isClassroomToken(value)),
    ),
    classroomOptions: buildCatalogBackedOptions(
      classroomCatalogs,
      currentSubject,
      rows.map((row) => row.classroom),
      normalizeTimetableClassroomName,
    ),
    dayOptions: unique(rows.map((row) => row.day)).sort(
      (left, right) => DAY_INDEX[left] - DAY_INDEX[right],
    ),
  };
}

function buildCurriculumOptions(
  rows,
  classTerms = [],
  teacherCatalogs = [],
  classroomCatalogs = [],
  currentSubject = "",
  classGroupOptions = [],
) {
  return {
    termOptions: buildOrderedTermOptions(classTerms, rows.map((row) => row.term)),
    classGroupOptions,
    statusOptions: ["수강", "개강 준비", "종강"],
    subjectOptions: unique(rows.map((row) => row.subject)).sort((left, right) =>
      left.localeCompare(right, "ko"),
    ),
    gradeOptions: unique(rows.map((row) => row.grade)).sort((left, right) =>
      left.localeCompare(right, "ko"),
    ),
    teacherOptions: buildCatalogBackedOptions(
      teacherCatalogs,
      currentSubject,
      rows.flatMap((row) => row.teacherNames || splitTeacherList(row.teacherSummary)),
    ),
    classroomOptions: buildCatalogBackedOptions(
      classroomCatalogs,
      currentSubject,
      rows.flatMap((row) => row.classroomNames || splitClassroomList(row.classroomSummary)),
      normalizeTimetableClassroomName,
    ),
  };
}

export function buildTimetableWorkspaceModel({
  classes = [],
  classTerms = [],
  classGroups = [],
  classGroupMembers = [],
  teacherCatalogs = [],
  classroomCatalogs = [],
  filters = {},
} = {}) {
  const eligibleClasses = toArray(classes);
  const groupContext = buildClassGroupContext(eligibleClasses, classTerms, classGroups, classGroupMembers);
  const allRows = sortTimetableRows(
    eligibleClasses.flatMap((classItem) =>
      parseAcademicSchedule(classItem?.schedule, classItem).map((slot) =>
        createTimetableRow(
          classItem,
          classTerms,
          slot,
          groupContext.groupsByClassId.get(text(classItem?.id)) || [],
        ),
      ),
    ),
  );

  const selectedGroup = text(filters.classGroupId || filters.classGroup || filters.group);
  const selectedGroupValues = getClassGroupFilterValues(groupContext.classGroupOptions, selectedGroup);
  const rows = allRows.filter((row) => {
    const selectedStatus = text(filters.status);
    return (
      matchesSearch(row.searchText, filters.search) &&
      rowMatchesClassGroup(row, selectedGroupValues) &&
      (!selectedStatus || row.statusFilter === selectedStatus) &&
      matchesFilter(row.subject, filters.subject) &&
      matchesFilter(row.grade, filters.grade) &&
      matchesFilter(row.teacher, filters.teacher) &&
      matchesFilter(row.classroom, filters.classroom) &&
      matchesFilter(row.day, filters.day)
    );
  });

  const options = buildTimetableOptions(
    eligibleClasses,
    classTerms,
    allRows.filter((row) =>
      rowMatchesClassGroup(row, selectedGroupValues) &&
      (!text(filters.status) || row.statusFilter === text(filters.status)) &&
      matchesFilter(row.subject, filters.subject),
    ),
    teacherCatalogs,
    classroomCatalogs,
    filters.subject,
    groupContext.classGroupOptions,
  );

  return {
    rows,
    teacherLoad: buildTeacherLoad(rows),
    classroomLoad: buildClassroomLoad(rows),
    yearOptions: options.yearOptions,
    termOptions: options.termOptions,
    subjectOptions: options.subjectOptions,
    classGroupOptions: options.classGroupOptions,
    statusOptions: options.statusOptions,
    gradeOptions: options.gradeOptions,
    teacherOptions: options.teacherOptions,
    classroomOptions: options.classroomOptions,
    dayOptions: options.dayOptions,
    summary: {
      classCount: new Set(rows.map((row) => row.classId)).size,
      slotCount: rows.length,
      teacherCount: new Set(rows.map((row) => row.teacher).filter(Boolean)).size,
      classroomCount: new Set(rows.map((row) => row.classroom).filter(Boolean)).size,
      weeklyMinutes: rows.reduce(
        (sum, row) => sum + Number(row.durationMinutes || 0),
        0,
      ),
    },
  };
}

export function buildCurriculumWorkspaceModel({
  classes = [],
  classTerms = [],
  classGroups = [],
  classGroupMembers = [],
  textbooks = [],
  progressLogs = [],
  teacherCatalogs = [],
  classroomCatalogs = [],
  filters = {},
} = {}) {
  const eligibleClasses = toArray(classes);
  const groupContext = buildClassGroupContext(eligibleClasses, classTerms, classGroups, classGroupMembers);
  const progressSummaryByClass = buildProgressLogSummary(progressLogs);
  const allRows = sortCurriculumRows(
    eligibleClasses.map((classItem) =>
      createCurriculumRow(
        classItem,
        classTerms,
        textbooks,
        progressSummaryByClass,
        groupContext.groupsByClassId.get(text(classItem?.id)) || [],
      ),
    ),
  );

  const selectedGroup = text(filters.classGroupId || filters.classGroup || filters.group);
  const selectedGroupValues = getClassGroupFilterValues(groupContext.classGroupOptions, selectedGroup);
  const rows = allRows.filter((row) => {
    const selectedStatus = text(filters.status);
    return (
      matchesSearch(row.searchText, filters.search) &&
      rowMatchesClassGroup(row, selectedGroupValues) &&
      (!selectedStatus || row.statusFilter === selectedStatus) &&
      matchesFilter(row.subject, filters.subject) &&
      matchesFilter(row.grade, filters.grade) &&
      (!text(filters.teacher) || row.teacherNames.includes(text(filters.teacher))) &&
      (!text(filters.classroom) || row.classroomNames.includes(normalizeTimetableClassroomName(filters.classroom))) &&
      matchesFilter(row.stateLabel, filters.state)
    );
  });

  const options = buildCurriculumOptions(
    allRows.filter((row) =>
      rowMatchesClassGroup(row, selectedGroupValues) &&
      (!text(filters.status) || row.statusFilter === text(filters.status)) &&
      matchesFilter(row.subject, filters.subject),
    ),
    classTerms,
    teacherCatalogs,
    classroomCatalogs,
    filters.subject,
    groupContext.classGroupOptions,
  );

  return {
    rows,
    ...options,
    stateOptions: unique(allRows.map((row) => row.stateLabel)),
    summary: {
      classCount: rows.length,
      managedClassCount: rows.filter((row) => row.totalSessions > 0).length,
      totalSessions: rows.reduce(
        (sum, row) => sum + Number(row.totalSessions || 0),
        0,
      ),
      completedSessions: rows.reduce(
        (sum, row) => sum + Number(row.completedSessions || 0),
        0,
      ),
      pendingSessions: rows.reduce(
        (sum, row) => sum + Number(row.delayedSessions || 0),
        0,
      ),
      linkedTextbooks: rows.reduce(
        (sum, row) => sum + Number(row.textbookCount || 0),
        0,
      ),
    },
  };
}

const TIMETABLE_BLOCK_PALETTES = [
  { bg: "var(--tt-block-bg-1)", border: "var(--tt-block-border-1)", text: "var(--tt-block-text-1)" },
  { bg: "var(--tt-block-bg-2)", border: "var(--tt-block-border-2)", text: "var(--tt-block-text-2)" },
  { bg: "var(--tt-block-bg-3)", border: "var(--tt-block-border-3)", text: "var(--tt-block-text-3)" },
  { bg: "var(--tt-block-bg-4)", border: "var(--tt-block-border-4)", text: "var(--tt-block-text-4)" },
  { bg: "var(--tt-block-bg-5)", border: "var(--tt-block-border-5)", text: "var(--tt-block-text-5)" },
  { bg: "var(--tt-block-bg-6)", border: "var(--tt-block-border-6)", text: "var(--tt-block-text-6)" },
];

function buildHalfHourSlots(startHour = 11, endHour = 24) {
  const slots = [];

  for (let hour = startHour; hour < endHour; hour += 1) {
    const safeHour = String(hour).padStart(2, "0");
    const nextHour = String(hour + 1).padStart(2, "0");
    slots.push(`${safeHour}:00-${safeHour}:30`);
    slots.push(`${safeHour}:30-${nextHour}:00`);
  }

  return slots.filter((slot) => !slot.startsWith("23:30-"));
}

const DEFAULT_TIMETABLE_TIME_SLOTS = buildHalfHourSlots();

function minutesToSlotIndex(value, startHour = 11) {
  const minutes = timeToMinutes(value);
  const baseMinutes = startHour * 60;
  return Math.max(0, Math.floor((minutes - baseMinutes) / 30));
}

function clampGridCount(value) {
  return Math.max(1, Math.min(2, Number(value) || 2));
}

function buildPaletteByClassId(rows = []) {
  const map = new Map();
  let paletteIndex = 0;

  rows.forEach((row) => {
    if (!row.classId || map.has(row.classId)) {
      return;
    }

    map.set(
      row.classId,
      TIMETABLE_BLOCK_PALETTES[paletteIndex % TIMETABLE_BLOCK_PALETTES.length],
    );
    paletteIndex += 1;
  });

  return map;
}

function groupTimetableRows(rows = [], getKey) {
  const map = new Map();

  rows.forEach((row) => {
    const key = text(getKey(row));
    if (!key) {
      return;
    }

    const currentRows = map.get(key);
    if (currentRows) {
      currentRows.push(row);
    } else {
      map.set(key, [row]);
    }
  });

  return map;
}

function getTimetableLessonKey(row) {
  const classId = text(row.classId);
  if (classId) {
    return classId;
  }

  return (
    [row.subject, row.title, row.teacher, row.classroom]
      .map((value) => text(value))
      .filter(Boolean)
      .join("|") || text(row.id)
  );
}

function buildRowScheduleLabel(row) {
  return row.day && row.start && row.end ? `${row.day} ${row.start}-${row.end}` : "";
}

function formatFullLessonSchedule(rows = []) {
  const schedulesByTime = new Map();

  rows
    .filter((row) => row.day && row.start && row.end)
    .sort((left, right) => {
      const dayDelta = (DAY_INDEX[left.day] ?? 99) - (DAY_INDEX[right.day] ?? 99);
      if (dayDelta !== 0) {
        return dayDelta;
      }

      return timeToMinutes(left.start) - timeToMinutes(right.start);
    })
    .forEach((row) => {
      const key = `${row.start}-${row.end}`;
      const current = schedulesByTime.get(key) || {
        start: row.start,
        end: row.end,
        days: [],
      };

      if (!current.days.includes(row.day)) {
        current.days.push(row.day);
      }

      schedulesByTime.set(key, current);
    });

  return [...schedulesByTime.values()]
    .map((schedule) => `${schedule.days.join("")} ${schedule.start}-${schedule.end}`)
    .join(" · ");
}

function buildLessonScheduleMap(rows = []) {
  const rowsByLesson = groupTimetableRows(rows, getTimetableLessonKey);
  const map = new Map();

  rowsByLesson.forEach((lessonRows, lessonKey) => {
    map.set(lessonKey, formatFullLessonSchedule(lessonRows));
  });

  return map;
}

function buildGridBlock(row, columnIndex, palette, detailValue, lessonScheduleMap) {
  const title = row.title || "";
  const lessonKey = getTimetableLessonKey(row);
  const schedule = lessonScheduleMap?.get(lessonKey) || buildRowScheduleLabel(row);
  const teacher = row.teacher || "";
  const classroom = row.classroom || "";

  return {
    key: row.id,
    columnIndex,
    startSlot: minutesToSlotIndex(row.start),
    endSlot: Math.max(minutesToSlotIndex(row.end), minutesToSlotIndex(row.start) + 1),
    backgroundColor: palette.bg,
    borderColor: palette.border,
    textColor: palette.text,
    clickable: false,
    editable: false,
    classId: row.classId || "",
    lessonKey,
    subject: row.subject || "",
    header: row.subject ? `[${row.subject}]` : "",
    title,
    detailLines: detailValue ? [{ value: detailValue }] : [],
    tooltipDetails: {
      title,
      schedule,
      teacher,
      classroom,
    },
    tooltip: [
      title,
      schedule ? `요일/시간 ${schedule}` : "",
      teacher,
      classroom,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function getGridAxisOptions(view, workspace) {
  if (view === "teacher-weekly") {
    return workspace.teacherOptions || [];
  }

  if (view === "classroom-weekly") {
    return workspace.classroomOptions || [];
  }

  return DAY_ORDER.slice();
}

function sanitizeSelectedTargets(selectedTargets = [], axisOptions = []) {
  const optionSet = new Set(axisOptions);
  return unique(
    selectedTargets.map((value) => text(value)).filter((value) => optionSet.has(value)),
  );
}

function buildTeacherWeeklyPanel(targetTeacher, rowsByTeacher, paletteByClassId, lessonScheduleMap) {
  const rows = rowsByTeacher.get(targetTeacher) || [];
  const blocks = rows.map((row) =>
    buildGridBlock(
      row,
      DAY_INDEX[row.day],
      paletteByClassId.get(row.classId) || TIMETABLE_BLOCK_PALETTES[0],
      row.classroom,
      lessonScheduleMap,
    ),
  );

  return {
    id: `teacher-${targetTeacher}`,
    title: targetTeacher,
    columns: DAY_ORDER.slice(),
    blocks,
  };
}

function buildClassroomWeeklyPanel(targetClassroom, rowsByClassroom, paletteByClassId, lessonScheduleMap) {
  const rows = rowsByClassroom.get(targetClassroom) || [];
  const blocks = rows.map((row) =>
    buildGridBlock(
      row,
      DAY_INDEX[row.day],
      paletteByClassId.get(row.classId) || TIMETABLE_BLOCK_PALETTES[0],
      row.teacher,
      lessonScheduleMap,
    ),
  );

  return {
    id: `classroom-${targetClassroom}`,
    title: targetClassroom,
    columns: DAY_ORDER.slice(),
    blocks,
  };
}

function buildDailyTeacherPanel(targetDay, workspace, rowsByDay, paletteByClassId, lessonScheduleMap) {
  const columns = workspace.teacherOptions || [];
  const teacherIndex = new Map(columns.map((value, index) => [value, index]));
  const rows = rowsByDay.get(targetDay) || [];
  const blocks = rows
    .map((row) => {
      const columnIndex = teacherIndex.get(row.teacher);
      if (columnIndex === undefined) {
        return null;
      }

      return buildGridBlock(
        row,
        columnIndex,
        paletteByClassId.get(row.classId) || TIMETABLE_BLOCK_PALETTES[0],
        row.classroom,
        lessonScheduleMap,
      );
    })
    .filter(Boolean);

  return {
    id: `day-teacher-${targetDay}`,
    title: targetDay,
    columns,
    blocks,
  };
}

function buildDailyClassroomPanel(targetDay, workspace, rowsByDay, paletteByClassId, lessonScheduleMap) {
  const columns = workspace.classroomOptions || [];
  const classroomIndex = new Map(columns.map((value, index) => [value, index]));
  const rows = rowsByDay.get(targetDay) || [];
  const blocks = rows
    .map((row) => {
      const columnIndex = classroomIndex.get(row.classroom);
      if (columnIndex === undefined) {
        return null;
      }

      return buildGridBlock(
        row,
        columnIndex,
        paletteByClassId.get(row.classId) || TIMETABLE_BLOCK_PALETTES[0],
        row.teacher,
        lessonScheduleMap,
      );
    })
    .filter(Boolean);

  return {
    id: `day-classroom-${targetDay}`,
    title: targetDay,
    columns,
    blocks,
  };
}

export function buildTimetableGridPanels({
  workspace,
  view = "teacher-weekly",
  gridCount = 2,
  selectedTargets = [],
} = {}) {
  const safeWorkspace = workspace || buildTimetableWorkspaceModel();
  const safeGridCount = clampGridCount(gridCount);
  const axisMode =
    view === "teacher-weekly"
      ? "teacher"
      : view === "classroom-weekly"
        ? "classroom"
        : "day";
  const axisOptions = getGridAxisOptions(view, safeWorkspace);
  const validTargets = sanitizeSelectedTargets(selectedTargets, axisOptions);
  const activeTargets =
    validTargets.length > 0 ? validTargets : axisOptions;
  const paletteByClassId = buildPaletteByClassId(safeWorkspace.rows);
  const lessonScheduleRows = safeWorkspace.timetableScheduleRows || safeWorkspace.allRows || safeWorkspace.rows;
  const lessonScheduleMap = buildLessonScheduleMap(lessonScheduleRows);
  const rowsByTeacher = groupTimetableRows(safeWorkspace.rows, (row) => row.teacher);
  const rowsByClassroom = groupTimetableRows(safeWorkspace.rows, (row) => row.classroom);
  const rowsByDay = groupTimetableRows(safeWorkspace.rows, (row) => row.day);

  const panels = activeTargets
    .map((target) => {
      if (view === "teacher-weekly") {
        return buildTeacherWeeklyPanel(target, rowsByTeacher, paletteByClassId, lessonScheduleMap);
      }

      if (view === "classroom-weekly") {
        return buildClassroomWeeklyPanel(target, rowsByClassroom, paletteByClassId, lessonScheduleMap);
      }

      if (view === "daily-teacher") {
        return buildDailyTeacherPanel(target, safeWorkspace, rowsByDay, paletteByClassId, lessonScheduleMap);
      }

      return buildDailyClassroomPanel(target, safeWorkspace, rowsByDay, paletteByClassId, lessonScheduleMap);
    })
    .filter((panel) => panel.columns.length > 0);

  return {
    view,
    axisMode,
    axisOptions,
    activeTargets,
    timeSlots: DEFAULT_TIMETABLE_TIME_SLOTS,
    panels,
  };
}
