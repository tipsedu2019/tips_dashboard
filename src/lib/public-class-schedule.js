// Public schedules are materialized sessions, never inputs for the internal
// planner. Every nested object is projected explicitly so new staff-only fields
// cannot become public through a spread, a saved snapshot, or a cache hit.
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rows(value) {
  return Array.isArray(value) ? value.filter(record) : [];
}

function fields(value, strings, numbers = []) {
  const result = {};
  if (!record(value)) return result;
  for (const key of strings) {
    if (typeof value[key] === "string" && value[key] !== "") result[key] = value[key];
  }
  for (const key of numbers) {
    if (typeof value[key] === "number" && Number.isFinite(value[key])) result[key] = value[key];
  }
  return result;
}

function range(value) {
  return fields(value, ["rangeType", "start", "end", "label", "status", "publicNote", "updatedAt"]);
}

function textbook(value) {
  return fields(value, ["textbookId", "role", "alias", "area", "subSubject", "startSessionId", "endSessionId"], ["order"]);
}

function billingPeriod(value, recordedSessionCounts) {
  const result = fields({
    id: value?.id ?? value?.period_id,
    label: value?.label ?? value?.period_label,
    startDate: value?.startDate ?? value?.start_date,
    endDate: value?.endDate ?? value?.end_date,
  }, ["id", "label", "startDate", "endDate"]);
  if (result.id && recordedSessionCounts.has(result.id)) {
    result.sessionCount = recordedSessionCounts.get(result.id);
  }
  return result;
}

export function publicLessons(value, depth = 0) {
  if (depth > 10) return [];
  return rows(value).map((lesson) => {
    const result = fields(lesson, ["id", "title", "name", "label", "parentId"], ["order", "pageStart", "pageEnd"]);
    if (Array.isArray(lesson.children)) result.children = publicLessons(lesson.children, depth + 1);
    return result;
  });
}

export function publicClassSchedule(value) {
  if (!record(value)) return null;
  const sessions = rows(value.sessions).map((session) => {
    const result = fields(session, [
      "id", "date", "scheduleState", "makeupDate", "originalDate",
      "startTime", "endTime", "classroomName", "teacherName", "progressStatus", "publicNote",
      "billingId", "billingLabel",
    ], ["sessionNumber"]);
    if (!result.scheduleState && typeof session.state === "string") result.scheduleState = session.state;
    if (!result.billingId && typeof session.billing_id === "string") result.billingId = session.billing_id;
    if (!result.billingLabel && typeof session.billing_label === "string") result.billingLabel = session.billing_label;
    if (typeof session.sessionKey === "string" && session.sessionKey !== session.id) result.sessionKey = session.sessionKey;
    const entries = rows(session.textbookEntries).map((entry) => {
      const mapped = textbook(entry);
      const plan = range(entry.plan);
      const actual = range(entry.actual);
      if (Object.keys(plan).length) mapped.plan = plan;
      if (Object.keys(actual).length) mapped.actual = actual;
      return mapped;
    });
    if (entries.length) result.textbookEntries = entries;
    return result;
  });
  const recordedSessionCounts = new Map();
  sessions.forEach((session) => {
    if (
      session.billingId &&
      (session.scheduleState === "active" || session.scheduleState === "makeup")
    ) {
      recordedSessionCounts.set(
        session.billingId,
        (recordedSessionCounts.get(session.billingId) || 0) + 1,
      );
    }
  });
  const result = {
    ...fields(value, ["generatedAt"], ["version"]),
    textbooks: rows(value.textbooks).map(textbook),
    sessions,
  };
  const billingPeriods = rows(value.billingPeriods ?? value.billing_periods)
    .map((period) => billingPeriod(period, recordedSessionCounts));
  if (billingPeriods.length) result.billingPeriods = billingPeriods;
  return result;
}
