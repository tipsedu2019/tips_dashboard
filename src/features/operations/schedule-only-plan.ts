type Plan = Record<string, unknown>;
type Session = Record<string, unknown>;
const contentFields = ["textbookEntries", "rangeStart", "rangeEnd", "rangeLabel", "progressStatus", "publicNote", "teacherNote"] as const;
const sessionKey = (row: Session) => String(row.sessionKey || row.session_key || row.id || "");

// Legacy producers did not always materialize cancellations/linked makeups alike.
// Rebuilding an untouched month can create extra rows or reuse a historical ID.
// Only the periods affected by the operator's scheduling edits are regenerated.
export function preserveUneditedLegacyPeriods(plan: Plan, savedPlan: Plan, baseline: Plan): Plan {
  if (JSON.stringify(plan.selectedDays) !== JSON.stringify(baseline.selectedDays)) return plan;
  const rows = (value: unknown): Session[] => Array.isArray(value) ? value : [];
  const generated = rows(plan.sessions), saved = rows(savedPlan.sessions);
  const changedDates = new Set<string>();
  for (const field of ['sessionStates', 'sessionSchedules']) {
    const before = (baseline[field] || {}) as Record<string, Session>;
    const after = (plan[field] || {}) as Record<string, Session>;
    for (const date of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[date]) === JSON.stringify(after[date])) continue;
      changedDates.add(date);
      for (const entry of [before[date], after[date]]) if (entry?.makeupDate) changedDates.add(String(entry.makeupDate));
    }
  }
  const periodFields = ['id', 'month', 'label', 'startDate', 'endDate', 'color'];
  const unchanged = new Set<string>();
  for (const period of rows(plan.billingPeriods)) {
    const previous = rows(baseline.billingPeriods).find(p => p.id === period.id);
    if (!previous || periodFields.some(field => period[field] !== previous[field])) continue;
    const periodId = String(period.id || '');
    const savedRows = saved.filter(row => row.billingId === periodId);
    if (!savedRows.length) continue;
    const periodRows = [...savedRows, ...generated.filter(row => row.billingId === periodId)];
    if ([...changedDates].some(date => (date >= String(period.startDate) && date <= String(period.endDate))
      || periodRows.some(row => row.date === date || row.originalDate === date || row.makeupDate === date))) continue;
    unchanged.add(periodId);
  }
  return { ...plan, sessions: [
    ...generated.filter(row => !unchanged.has(String(row.billingId))),
    ...saved.filter(row => unchanged.has(String(row.billingId))),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date))) };
}

// The scheduling editor owns schedule details only. Historical learning
// content remains untouched when the legacy schedule is regenerated and saved.
export function preserveScheduleLearningContent(plan: Plan, savedPlan: Plan): Plan {
  const savedSessions = Array.isArray(savedPlan.sessions) ? savedPlan.sessions as Session[] : [];
  const saved = new Map(savedSessions.map(row => [sessionKey(row), row]));
  const byDate = new Map<string, Session[]>();
  for (const row of savedSessions) {
    const date = String(row.date || row.session_date || "");
    if (date) byDate.set(date, [...(byDate.get(date) || []), row]);
  }
  return {
    ...plan,
    textbooks: Array.isArray(savedPlan.textbooks) ? savedPlan.textbooks : [],
    sessions: (Array.isArray(plan.sessions) ? plan.sessions as Session[] : []).map(row => {
      // Legacy IDs include state and sequence, so a holiday toggle can change
      // the key of an otherwise identical lesson. Only use an unambiguous date.
      const dateMatches = byDate.get(String(row.date || row.session_date || "")) || [];
      const previous = saved.get(sessionKey(row)) || (dateMatches.length === 1 ? dateMatches[0] : undefined);
      const result = { ...row };
      for (const field of contentFields) {
        if (previous && Object.prototype.hasOwnProperty.call(previous, field)) result[field] = previous[field];
        else delete result[field];
      }
      return result;
    }),
  };
}

export function scheduleOnlyDraft(plan: Plan): Plan {
  return {
    ...plan,
    textbooks: [],
    sessions: (Array.isArray(plan.sessions) ? plan.sessions as Session[] : []).map(row => {
      const result = { ...row };
      for (const field of contentFields) delete result[field];
      return result;
    }),
  };
}

const occupancyFields = ['startTime', 'endTime', 'teacherCatalogId', 'classroomCatalogId', 'teacherName', 'classroomName'];
// Match the final legacy SQL producer's occupancy fingerprint. In particular,
// identity, unknown wire fields and absent/false forced status are significant.
const occupancyIgnoredFields = new Set([
  'memo', 'publicNote', 'teacherNote', 'textbook', 'textbooks', 'homework', 'content',
  'lessonContent', 'learningContent', 'textbookEntries', 'progressStatus',
  'sessionKey', 'session_key', 'billingId', 'billingLabel', 'billingColor', 'sessionNumber', 'state',
]);
const nonemptyJsonText = (value: unknown) => value === undefined || value === null || value === '' ? null : String(value);
const legacyState = (row: Session) => nonemptyJsonText(row.scheduleState) ?? nonemptyJsonText(row.state) ?? 'active';
function orderedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedJson);
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map(key => [key, orderedJson(object[key])]));
  }
  return value;
}
function legacyOccupancyKey(row: Session): string {
  // Compare what is actually sent to SQL; undefined properties disappear.
  const wire = JSON.parse(JSON.stringify(row)) as Session;
  const occupancy = Object.fromEntries(Object.entries(wire).filter(([key]) => !occupancyIgnoredFields.has(key)));
  occupancy.identity = nonemptyJsonText(wire.id) ?? nonemptyJsonText(wire.sessionKey);
  occupancy.scheduleState = legacyState(wire);
  return JSON.stringify(orderedJson(occupancy));
}

// Existing incomplete occupancy stays readable. New past regular lessons and
// every explicit override need complete details; SQL remains the final guard.
export function legacyLessonScheduleValidationError(
  plan: Plan,
  savedPlan: Plan,
  today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()),
): string {
  const saved = Array.isArray(savedPlan.sessions) ? savedPlan.sessions as Session[] : [];
  const sessions = Array.isArray(plan.sessions) ? plan.sessions as Session[] : [];
  const existing = new Map<string, number>();
  saved.forEach(row => {
    const identity = legacyOccupancyKey(row);
    existing.set(identity, (existing.get(identity) || 0) + 1);
  });
  const dateCounts = new Map<string, number>();
  sessions.forEach(row => {
    const date = String(row.date || '');
    dateCounts.set(date, (dateCounts.get(date) || 0) + 1);
  });
  for (const row of sessions) {
    const identity = legacyOccupancyKey(row), count = existing.get(identity) || 0;
    if (count) { existing.set(identity, count - 1); continue; }
    const state = legacyState(row);
    if (['exception', 'skipped', 'tbd'].includes(state)) continue;
    const date = String(row.date || '선택한 날짜');
    const regular = state === 'active' && !row.isForced && !row.originalDate;
    const hasOverride = occupancyFields.some(field => Object.prototype.hasOwnProperty.call(row, field) && row[field] !== undefined);
    if (regular && !hasOverride && date >= today) continue;
    if (regular && hasOverride && (dateCounts.get(date) || 0) > 1) return `${date} 같은 날짜에 여러 회차가 있어 개별 시간·선생님·강의실을 수정할 수 없습니다. 입력을 확인해 주세요.`;
    const kind = regular ? '수업' : '보강';
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(row.startTime || '')) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(row.endTime || ''))) return `${date} ${kind}의 시작·종료 시간을 입력해 주세요.`;
    if (String(row.startTime) >= String(row.endTime)) return `${date} 종료 시간을 시작 시간 이후로 입력해 주세요.`;
    if (!(row.teacherCatalogId || row.teacherName) || !(row.classroomCatalogId || row.classroomName)) return `${date} ${kind}의 선생님·강의실을 선택해 주세요.`;
  }
  return '';
}
