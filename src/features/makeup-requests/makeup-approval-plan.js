import { hasCancelPart, hasMakeupPart, normalizeMakeupSlots, toDateKey } from './makeup-request-model.js';
import { findLegacyMakeupPair, matchingLegacyMakeupBinding } from './makeup-legacy-pair.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const text = value => typeof value === 'string' ? value.trim() : '';
const record = value => value && typeof value === 'object' && !Array.isArray(value);
function invalid() { throw new Error('makeup_approval_schedule_incomplete'); }

function instant(value) {
  const raw = text(value);
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) || /\.\d*[1-9]\d*/.test(raw)) invalid();
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime()) || date.getUTCSeconds() || date.getUTCMilliseconds()) invalid();
  return date;
}

function slotOccupancy(slot, teacher, classrooms) {
  const start = instant(slot.startAt), end = instant(slot.endAt);
  if (end <= start || end - start > 86_400_000) invalid();
  const date = toDateKey(start), endDate = toDateKey(end);
  const startTime = clock.format(start), endTime = clock.format(end);
  const midnight = endDate !== date && endTime === '00:00' && end - start < 86_400_000;
  if (endDate !== date && !midnight) invalid();
  const rooms = classrooms.filter(room => text(room.name) === text(slot.classroom));
  if (rooms.length !== 1 || !UUID.test(text(rooms[0].id))) invalid();
  return { date, startTime, endTime: midnight ? '24:00' : endTime,
    teacherCatalogId: teacher.id, teacherName: teacher.name,
    classroomCatalogId: rooms[0].id, classroomName: rooms[0].name };
}

// Approval is a bounded edit, not a regeneration of billing/history/defaults.
// Resources are fetched server-side from the request's IDs/names, never inferred
// from current weekly defaults or copied from a historical exception.
export function buildLegacyMakeupApprovalPlan(rawPlan, request, { teacher = null, classrooms = [], legacyBinding = null } = {}) {
  if (!record(rawPlan) || !UUID.test(text(request.id))
    || (rawPlan.sessions !== undefined && !Array.isArray(rawPlan.sessions))) invalid();
  const before = rawPlan.sessions || [];
  if (!before.every(record)) invalid();
  const hasCancel = hasCancelPart(request), hasMakeup = hasMakeupPart(request);
  const cancelDate = text(request.cancel_date);
  if (hasCancel && (!/^\d{4}-\d{2}-\d{2}$/.test(cancelDate)
    || !Number.isFinite(Date.parse(`${cancelDate}T00:00:00Z`))
    || new Date(`${cancelDate}T00:00:00Z`).toISOString().slice(0, 10) !== cancelDate)) invalid();
  const canceled = hasCancel ? before.filter(row => row.date === cancelDate) : [];
  if (canceled.length > 1) invalid();
  if (hasMakeup && (!record(teacher) || !UUID.test(text(teacher.id))
    || teacher.id !== request.teacher_catalog_id || !text(teacher.name))) invalid();
  const slots = hasMakeup ? normalizeMakeupSlots(request, text(request.makeup_classroom)) : [];
  if (hasMakeup && (!slots.length
    || (request.makeup_slots !== undefined && !Array.isArray(request.makeup_slots))
    || (request.makeup_slots?.length && request.makeup_slots.length !== slots.length))) invalid();
  // A date-level legacy cancellation cannot identify one of several same-date
  // lessons. Do not reopen weekly defaults by guessing this exceptional case.
  const occupancies = slots.map(slot => slotOccupancy(slot, teacher, classrooms));
  if (hasCancel && occupancies.some(slot => slot.date === cancelDate)) invalid();
  if (canceled.some(row => !['active', ''].includes(text(row.scheduleState || row.state)))) {
    const binding = matchingLegacyMakeupBinding(request, slots, legacyBinding ? [legacyBinding] : []);
    const pair = occupancies.length === 1 ? findLegacyMakeupPair(rawPlan, cancelDate, occupancies[0].date) : null;
    if (!binding || binding.mode !== 'reuse' || !pair || pair.original.id !== binding.originalId || pair.makeup.id !== binding.makeupId) invalid();
    const adoption = { version: 1, requestUpdatedAt: binding.requestUpdatedAt, originalId: pair.original.id, makeupId: pair.makeup.id };
    return { ...rawPlan, sessions: before.map(row => row === pair.original
      ? { ...row, makeupRequestId: request.id, makeupRequestRole: 'cancel' }
      : row === pair.makeup ? { ...row, ...occupancies[0], makeupRequestId: request.id, makeupRequestRole: 'makeup', makeupAdoption: adoption } : row) };
  }
  const ids = before.map(row => text(row.id || row.sessionKey));
  const canceledId = text(canceled[0]?.id || canceled[0]?.sessionKey);
  if (canceled.length && (!canceledId || ids.filter(id => id === canceledId).length !== 1)) invalid();
  const reason = text(request.reason);
  const state = { ...(rawPlan.sessionStates?.[cancelDate] || {}), state: 'exception',
    memo: reason ? `휴강: ${reason}` : '휴강', makeupDate: '' };
  const sessions = before.map(row => row === canceled[0]
    ? { ...row, makeupRequestId: request.id, makeupRequestRole: 'cancel', scheduleState: 'exception', state: 'exception', memo: state.memo, makeupDate: '' }
    : row);
  if (hasCancel && !canceled.length) {
    const id = `makeup-cancel:${request.id}`;
    if (ids.includes(id)) invalid();
    sessions.push({ id, sessionKey: id, makeupRequestId: request.id, makeupRequestRole: 'cancel', date: cancelDate, scheduleState: 'exception', state: 'exception',
      memo: state.memo, makeupDate: '', originalDate: '', isForced: false, textbookEntries: [] });
  }
  for (const [index, occupancy] of occupancies.entries()) {
    const id = `makeup-request:${request.id}:${index}`;
    if (ids.includes(id)) invalid();
    // Only billing attribution comes from the uniquely identified canceled row.
    // Do not duplicate its actual lesson content, progress, or exception resources.
    const billing = Object.fromEntries(['billingId', 'billingLabel', 'billingColor']
      .filter(key => canceled[0] && Object.hasOwn(canceled[0], key)).map(key => [key, canceled[0][key]]));
    sessions.push({ ...billing, id, sessionKey: id, makeupRequestId: request.id, ...occupancy,
      scheduleState: 'makeup', state: 'makeup', originalDate: hasCancel ? cancelDate : '', makeupDate: '',
      isForced: false, sessionNumber: null, memo: '보강', publicNote: '', teacherNote: '',
      progressStatus: 'pending', textbookEntries: [] });
  }
  return { ...rawPlan, sessions, ...(hasCancel ? { sessionStates: { ...(rawPlan.sessionStates || {}), [cancelDate]: state } } : {}) };
}
