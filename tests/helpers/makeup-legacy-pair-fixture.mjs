import { row } from './makeup-numbered-harness.mjs';

// Entirely synthetic. No operational request, person or room identifiers.
export const legacyId = n => `bf061100-0000-4000-8000-${String(n).padStart(12, '0')}`;
export function legacyPairFixture() {
  const teacher = { id: legacyId(1), name: 'Synthetic pair teacher' };
  const room = { id: legacyId(2), name: 'Synthetic pair room' };
  const slot = { startAt: '2050-10-06T09:00:00Z', endAt: '2050-10-06T11:00:00Z', classroom: room.name };
  const entry = row(3, {
    id: legacyId(3), classId: legacyId(4), className: 'Synthetic pair class', requestKind: 'cancel_makeup',
    cancelDate: '2050-10-20', makeupStartAt: slot.startAt, makeupEndAt: slot.endAt, makeupClassroom: room.name,
    makeupSlots: [slot], teacherCatalogId: teacher.id, teacherLabel: teacher.name, canDecideSubject: true,
    updatedAt: '2050-09-30T00:00:00.123456+00:00', createdAt: '2050-09-30T00:00:00+00:00',
  });
  const request = {
    id: entry.id, class_id: entry.classId, class_name: entry.className, subject: entry.subject,
    request_kind: entry.requestKind, status: entry.status, cancel_date: entry.cancelDate,
    updated_at: entry.updatedAt, makeup_start_at: slot.startAt, makeup_end_at: slot.endAt,
    makeup_classroom: room.name, makeup_slots: [slot], teacher_catalog_id: teacher.id,
  };
  const original = { id: 'synthetic-original', sessionKey: 'synthetic-original', date: entry.cancelDate, state: 'exception', scheduleState: 'exception', makeupDate: '2050-10-06', teacherNote: 'Preserve original content' };
  const makeup = { id: 'synthetic-makeup', sessionKey: 'synthetic-makeup', date: '2050-10-06', state: 'makeup', scheduleState: 'makeup', originalDate: entry.cancelDate, originalSessionId: original.id, teacherNote: 'Preserve makeup content', billingId: 'synthetic-billing' };
  const plan = { sessions: [original, makeup], sessionStates: { [entry.cancelDate]: { state: 'exception', makeupDate: makeup.date } } };
  const occupancy = { id: `legacy-session:${entry.classId}:${makeup.id}`, classId: entry.classId, className: entry.className, date: makeup.date, startMinute: 1170, endMinute: 1290, classroom: room.name, uncertain: false, allRooms: false };
  const binding = {
    version: 1, mode: 'reuse', requestId: entry.id, classId: entry.classId, requestUpdatedAt: entry.updatedAt,
    cancelDate: entry.cancelDate, originalId: original.id, makeupId: makeup.id,
    startAt: '2050-10-06T09:00:00.000Z', endAt: '2050-10-06T11:00:00.000Z', classroom: room.name, occupancy,
  };
  return { teacher, room, slot, entry, request, original, makeup, plan, occupancy, binding };
}
