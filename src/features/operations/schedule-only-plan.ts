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

// Validate only newly introduced/changed non-regular occupancy. Older incomplete
// records remain readable and metadata-only saves must not rewrite their history.
export function legacyLessonScheduleValidationError(plan: Plan, savedPlan: Plan): string {
  const saved = Array.isArray(savedPlan.sessions) ? savedPlan.sessions as Session[] : [];
  const fields = ['date', 'originalDate', 'makeupDate', 'isForced', 'startTime', 'endTime', 'teacherCatalogId', 'classroomCatalogId', 'teacherName', 'classroomName'];
  const key = (row: Session) => JSON.stringify([String(row.scheduleState || row.state || 'active'), ...fields.map(field => row[field] ?? '')]);
  const existing = new Map<string, number>();
  saved.forEach(row => existing.set(key(row), (existing.get(key(row)) || 0) + 1));
  for (const row of Array.isArray(plan.sessions) ? plan.sessions as Session[] : []) {
    const identity = key(row), count = existing.get(identity) || 0;
    if (count) { existing.set(identity, count - 1); continue; }
    const state = String(row.scheduleState || row.state || 'active');
    if (['exception', 'skipped', 'tbd'].includes(state) || (state === 'active' && !row.isForced && !row.originalDate)) continue;
    const date = String(row.date || '선택한 날짜');
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(row.startTime || '')) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(row.endTime || ''))) return `${date} 보강의 시작·종료 시간을 입력해 주세요.`;
    if (String(row.startTime) >= String(row.endTime)) return `${date} 종료 시간을 시작 시간 이후로 입력해 주세요.`;
    if (!(row.teacherCatalogId || row.teacherName) || !(row.classroomCatalogId || row.classroomName)) return `${date} 보강의 선생님·강의실을 선택해 주세요.`;
  }
  return '';
}
