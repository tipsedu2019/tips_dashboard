import { buildSchedulePlanForSave, deriveSelectedDaysFromSchedule, isRequestMakeupSession } from '../../lib/class-schedule-planner.js';

type Row = Record<string, unknown>;
type Plan = Record<string, unknown>;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value : [];
const object = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const key = (row: Row) => String(object(row).id || object(row).sessionKey || '');
const fields = ['startTime', 'endTime', 'teacherCatalogId', 'classroomCatalogId', 'teacherName', 'classroomName'];
const owns = (row: Row, field: string) => Object.prototype.hasOwnProperty.call(row, field);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const dateValid = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

// Keep unique-date compatibility data aligned with explicit scalar row values.
// Legacy names are NOT row overrides when a date map exists: copying them would
// replace an unedited map-selected resource. Preserve map names and metadata.
function syncScheduleFields(plan: Plan, date: string, row: Row, cleared: string[] = []): unknown {
  const schedules = object(plan.sessionSchedules), entry = schedules[date];
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return plan.sessionSchedules;
  const details = object(entry);
  const remaining = { ...details };
  cleared.forEach(field => delete remaining[field]);
  fields.slice(0, 4).filter(field => owns(row, field)).forEach(field => { remaining[field] = row[field]; });
  if (same(remaining, details)) return plan.sessionSchedules;
  const next = { ...schedules };
  if (Object.keys(remaining).length) next[date] = remaining;
  else delete next[date];
  return next;
}

// Reading and saving materialized lessons must never run the weekly generator.
// In particular, keep absent fields, whitespace, unknown history and array order.
export function authoredLegacyLessonDraft(plan: Plan, defaults: Plan = {}): Plan {
  return { ...plan,
    selectedDays: Array.isArray(plan.selectedDays) ? plan.selectedDays : deriveSelectedDaysFromSchedule(String(defaults.schedule || '')),
    billingPeriods: rows(plan.billingPeriods), sessions: rows(plan.sessions),
  };
}

function updatePeriodCounts(plan: Plan, affected: Set<unknown>): Plan {
  return { ...plan, billingPeriods: rows(plan.billingPeriods).map(period => affected.has(period.id)
    ? { ...period, totalSessions: rows(plan.sessions).filter(row => object(row).billingId === period.id && !['exception', 'skipped', 'tbd'].includes(String(object(row).scheduleState || object(row).state || 'active'))).length }
    : period) };
}

// Only explicit period additions/range changes invoke the planner, in isolation.
// Existing rows keep their position and identity; newly requested dates append.
export function applyAuthoredLegacyLessonEdit(next: Plan, previous: Plan, defaults: Plan = {}): Plan {
  let plan = authoredLegacyLessonDraft(next, defaults);
  let sessions = rows(plan.sessions);
  const periods = rows(plan.billingPeriods), oldPeriods = rows(previous.billingPeriods);
  const affected = new Set<unknown>();
  const removed = new Set(oldPeriods.filter(old => !periods.some(period => period.id === old.id)).map(period => period.id));
  if (removed.size) sessions = sessions.filter(row => !removed.has(object(row).billingId) || isRequestMakeupSession(row));
  for (const period of periods) {
    const old = oldPeriods.find(item => item.id === period.id);
    if (old && period.startDate === old.startDate && period.endDate === old.endDate) continue;
    if (!dateValid(period.startDate) || !dateValid(period.endDate) || period.endDate < period.startDate) continue;
    affected.add(period.id);
    if (old) sessions = sessions.filter(row => object(row).billingId !== period.id || isRequestMakeupSession(row)
      || typeof object(row).date !== 'string' || String(object(row).date) < String(old.startDate) || String(object(row).date) > String(old.endDate)
      || (String(object(row).date) >= period.startDate! && String(object(row).date) <= period.endDate!));
    const generated = buildSchedulePlanForSave({ ...plan, billingPeriods: [period], sessions: [], textbooks: [], history: [] }, defaults);
    const existingDates = new Set(sessions.filter(row => object(row).billingId === period.id).map(row => object(row).date));
    sessions = [...sessions, ...generated.sessions.filter((row: Row) => !existingDates.has(object(row).date)
      && (!old || String(object(row).date) < String(old.startDate) || String(object(row).date) > String(old.endDate))).map((row: Row) => {
      // Isolated generator ordinals are not identities. Reusing them would
      // attach existing number-only progress to a new, unrelated lesson.
      const lesson: Row = { ...row, sessionNumber: null };
      for (const field of ['textbookEntries', 'progressStatus', 'publicNote', 'teacherNote']) delete lesson[field];
      return lesson;
    })];
  }
  plan = { ...plan, sessions };
  // Calendar controls still express a date-level intent. Apply it only where
  // the date identifies one ordinary row; detail controls use stable IDs below.
  for (const date of new Set([...Object.keys(object(previous.sessionStates)), ...Object.keys(object(plan.sessionStates))])) {
    const old = object(previous.sessionStates)[date], entry = object(plan.sessionStates)[date];
    if (same(old, entry)) continue;
    const onDate = rows(plan.sessions).filter(row => object(row).date === date && !isRequestMakeupSession(row));
    if (onDate.length > 1) continue;
    if (onDate[0] && !same(onDate[0], rows(previous.sessions).find(row => key(row) === key(onDate[0])))) continue;
    if (!onDate.length) {
      const period = periods.find(p => date >= String(p.startDate) && date <= String(p.endDate));
      if (!period || !dateValid(date)) continue;
      const id = `lesson:${crypto.randomUUID()}`;
      const row = { id, sessionKey: id, date, billingId: period.id, billingLabel: period.label, billingColor: period.color,
        scheduleState: 'active', state: 'active', isForced: true, sessionNumber: null };
      plan = { ...plan, sessions: [...rows(plan.sessions), row] };
      onDate.push(row);
    }
    const state = object(entry);
    plan = patchAuthoredLegacyLesson(plan, key(onDate[0]), {
      scheduleState: state.state === 'force_active' ? 'active' : state.state || 'active',
      state: state.state === 'force_active' ? 'active' : state.state || 'active',
      ...(state.state === 'force_active' ? { isForced: true } : {}),
    });
    if (String(object(old).makeupDate || '') !== String(state.makeupDate || '')) plan = setAuthoredLegacyMakeupDate(plan, key(onDate[0]), String(state.makeupDate || ''), String(state.makeupMemo || ''));
  }
  for (const date of new Set([...Object.keys(object(previous.sessionSchedules)), ...Object.keys(object(plan.sessionSchedules))])) {
    const details = object(plan.sessionSchedules)[date];
    const oldDetails = object(object(previous.sessionSchedules)[date]);
    if (same(details, object(previous.sessionSchedules)[date])) continue;
    const onDate = rows(plan.sessions).filter(row => object(row).date === date && !isRequestMakeupSession(row));
    if (onDate.length !== 1 || rows(plan.sessions).filter(row => object(row).date === date).length !== 1) continue;
    if (!same(onDate[0], rows(previous.sessions).find(row => key(row) === key(onDate[0])))) continue;
    const row = { ...onDate[0] };
    const changed = fields.filter(field => !same(oldDetails[field], object(details)[field]) || owns(oldDetails, field) !== owns(object(details), field));
    if (!changed.length) continue;
    for (const field of changed) {
      if (owns(object(details), field)) row[field] = object(details)[field];
      else delete row[field];
    }
    plan = { ...plan, sessionSchedules: syncScheduleFields(plan, date, row, changed),
      sessions: rows(plan.sessions).map(item => item === onDate[0] ? row : item) };
  }
  return updatePeriodCounts(plan, affected);
}

export function patchAuthoredLegacyLesson(plan: Plan, id: string, patch: Row): Plan {
  const matches = rows(plan.sessions).filter(row => key(row) === id);
  if (matches.length !== 1 || isRequestMakeupSession(matches[0])) return plan;
  const before = matches[0], after = { ...before, ...patch };
  let sessionStates = plan.sessionStates;
  // Keep the legacy state map compatible when it unambiguously names this row.
  if (rows(plan.sessions).filter(row => object(row).date === before.date).length === 1 && ('scheduleState' in patch || 'memo' in patch)) {
    sessionStates = { ...object(sessionStates), [String(before.date)]: { ...object(object(sessionStates)[String(before.date)]),
      ...('scheduleState' in patch ? { state: patch.scheduleState } : {}), ...('memo' in patch ? { memo: patch.memo } : {}) } };
  }
  return { ...plan, sessionStates, sessions: rows(plan.sessions).map(row => row === before ? after : row) };
}

export function setAuthoredLegacyLessonFields(plan: Plan, id: string, next: Row, displayed: Row, reset = false): Plan {
  const matches = rows(plan.sessions).filter(row => key(row) === id);
  if (matches.length !== 1 || isRequestMakeupSession(matches[0])) return plan;
  const before = matches[0], date = String(before.date);
  const uniqueDate = rows(plan.sessions).filter(row => object(row).date === date).length === 1;
  const row = { ...before };
  const cleared: string[] = [];
  if (reset) [...fields, 'classroomUnresolved'].forEach(field => delete row[field]);
  else for (const field of fields.slice(0, 4)) if (owns(next, field) && next[field] !== displayed[field]) {
    row[field] = next[field];
    if (field === 'teacherCatalogId') { delete row.teacherName; cleared.push('teacherName'); }
    if (field === 'classroomCatalogId') { delete row.classroomName; delete row.classroomUnresolved; cleared.push('classroomName', 'classroomUnresolved'); }
  }
  if (!reset && same(row, before)) return plan;
  return { ...plan, sessionSchedules: uniqueDate ? syncScheduleFields(plan, date, row, reset ? [...fields, 'classroomUnresolved'] : cleared) : plan.sessionSchedules,
    sessions: rows(plan.sessions).map(item => item === before ? row : item) };
}

export function setAuthoredLegacyMakeupDate(plan: Plan, id: string, date: string, memo = ''): Plan {
  const source = rows(plan.sessions).find(row => key(row) === id);
  if (!source || isRequestMakeupSession(source) || (date && (!dateValid(date) || date === source.date))) return plan;
  const linked = rows(plan.sessions).filter(row => object(row).originalDate === source.date && object(row).billingId === source.billingId && !isRequestMakeupSession(row));
  if (linked.length > 1 || rows(plan.sessions).filter(row => object(row).date === source.date).length !== 1) return plan;
  if (!date && !source.makeupDate && !object(object(plan.sessionStates)[String(source.date)]).makeupDate && !linked.length) return plan;
  // Unlinking does not undo a cancellation. Callers that explicitly restore a
  // normal lesson (calendar/state controls) own that separate state transition.
  let next = patchAuthoredLegacyLesson(plan, id, { ...(date ? { state: 'exception', scheduleState: 'exception' } : {}), makeupDate: date });
  next = { ...next, sessionStates: { ...object(next.sessionStates), [String(source.date)]: {
    ...object(object(next.sessionStates)[String(source.date)]), makeupDate: date,
  } } };
  if (!date) return { ...next, sessions: rows(next.sessions).filter(row => row !== linked[0]) };
  if (linked[0]) return patchAuthoredLegacyLesson(next, key(linked[0]), { date });
  const makeupId = `lesson:${crypto.randomUUID()}`;
  next = { ...next, sessions: [...rows(next.sessions), { id: makeupId, sessionKey: makeupId, date,
    billingId: source.billingId, billingLabel: source.billingLabel, billingColor: source.billingColor,
    originalDate: source.date, scheduleState: 'makeup', state: 'makeup', memo, sessionNumber: null,
    ...Object.fromEntries(Object.entries(object(object(plan.sessionSchedules)[date])).filter(([field]) => fields.includes(field))),
  }] };
  return next;
}

// This writer checks authored structure/references, not inferred occupancy or
// another lesson's date, teacher, room or interval. Unchanged history is opaque.
export function authoredLegacyLessonValidationError(plan: Plan, saved: Plan, catalogs: Row = {}): string {
  const oldRows = rows(saved.sessions), sessions = rows(plan.sessions);
  const unchanged = new Map<string, number>(), identities = new Map<string, number>();
  oldRows.forEach(row => { const fingerprint = JSON.stringify(row); unchanged.set(fingerprint, (unchanged.get(fingerprint) || 0) + 1); });
  sessions.forEach(row => identities.set(key(row), (identities.get(key(row)) || 0) + 1));
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const row of sessions) {
    const fingerprint = JSON.stringify(row), count = unchanged.get(fingerprint) || 0;
    if (count) { unchanged.set(fingerprint, count - 1); continue; }
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return '회차 정보 형식을 확인해 주세요.';
    const id = key(row), date = String(row.date || '선택한 날짜');
    if (!id || typeof (row.id || row.sessionKey) !== 'string' || identities.get(id) !== 1) return `${date} 회차 ID가 없거나 중복되었습니다.`;
    const old = oldRows.find(item => key(item) === id);
    const changed = (field: string) => !old || !same(row[field], old[field]);
    if (changed('date') && !dateValid(row.date)) return `${date} 날짜를 확인해 주세요.`;
    if ((changed('scheduleState') || changed('state')) && !['active', 'exception', 'makeup', 'tbd', 'skipped'].includes(String(row.scheduleState || row.state || 'active'))) return `${date} 회차 상태를 확인해 주세요.`;
    if (changed('memo') && row.memo !== undefined && row.memo !== null && typeof row.memo !== 'string') return `${date} 메모 형식을 확인해 주세요.`;
    for (const field of ['startTime', 'endTime']) {
      const value = row[field];
      if (!changed(field) || value === undefined || value === null || value === '') continue;
      if (typeof value !== 'string' || !/^[0-9]{1,2}:[0-5][0-9](?::00(?:\.0+)?)?$/.test(value)
        || (Number(value.split(':')[0]) > 23 && !(field === 'endTime' && /^24:00(?::00(?:\.0+)?)?$/.test(value)))) return `${date} 시작·종료 시간을 확인해 주세요.`;
    }
    if ((changed('startTime') || changed('endTime')) && row.startTime && row.endTime) {
      const minutes = (value: unknown) => String(value).split(':').slice(0, 2).map(Number).reduce((a, b) => a * 60 + b);
      if (minutes(row.startTime) >= minutes(row.endTime)) return `${date} 종료 시간을 시작 시간 이후로 입력해 주세요.`;
    }
    for (const [field, catalog, label] of [['teacherCatalogId', 'teachers', '선생님'], ['classroomCatalogId', 'rooms', '강의실']]) {
      const value = row[field];
      if (!changed(field) || value === undefined || value === null || value === '') continue;
      if (typeof value !== 'string' || !uuid.test(value) || !rows(catalogs[catalog]).some(item => item.id === value)) return `${date} ${label}을 다시 선택해 주세요.`;
    }
    for (const [field, idField, catalog, label] of [['teacherName', 'teacherCatalogId', 'teachers', '선생님'], ['classroomName', 'classroomCatalogId', 'rooms', '강의실']]) {
      const value = row[field];
      if (!changed(field) || row[idField] || value === undefined || value === null || value === '') continue;
      if (typeof value !== 'string' || (field === 'classroomName' && !['', '미정', '강의실 미정'].includes(value.trim())
        && rows(catalogs[catalog]).filter(item => String(item.name).trim() === value.trim()).length !== 1)
        || (field === 'teacherName' && value.trim() && rows(catalogs[catalog]).filter(item => String(item.name).trim() === value.trim()).length !== 1)) return `${date} ${label}을 다시 선택해 주세요.`;
    }
  }
  return '';
}
