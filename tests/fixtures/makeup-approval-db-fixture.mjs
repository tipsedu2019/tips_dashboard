import { buildLegacyMakeupApprovalPlan } from '../../src/features/makeup-requests/makeup-approval-plan.js';
import { applyMakeupRequestToSchedulePlan, buildMakeupCalendarDrafts, extractMakeupCalendarMeta } from '../../src/features/makeup-requests/makeup-request-model.js';
import { buildAcademicEventMutationPayload } from '../../src/features/operations/academic-event-utils.js';

const id = n => `aa041004-0000-4000-8000-${String(n).padStart(12, '0')}`;
const teacher = { id: id(1), name: 'Synthetic requested teacher' };
const room = { id: id(2), name: 'Synthetic requested room' };
const request = { id: id(3), class_id: id(4), class_name: 'Synthetic approval', subject: '영어',
  request_kind: 'cancel_makeup', cancel_date: '2050-10-07', teacher_catalog_id: teacher.id,
  makeup_start_at: '2050-10-06T06:00:00Z', makeup_end_at: '2050-10-06T08:00:00Z', makeup_classroom: room.name,
  makeup_slots: [
    { startAt: '2050-10-06T10:00:00+09:00', endAt: '2050-10-06T11:00:00+09:00', classroom: room.name },
    { startAt: '2050-10-06T12:00:00+09:00', endAt: '2050-10-06T13:00:00+09:00', classroom: room.name },
    { startAt: '2050-10-08T12:00:00+09:00', endAt: '2050-10-08T13:00:00+09:00', classroom: room.name },
  ] };
const plan = { subject: '영어', className: request.class_name, selectedDays: [5],
  billingPeriods: [{ id: 'oct', month: 10, label: '10월', startDate: '2050-10-01', endDate: '2050-10-31' }],
  sessionStates: {}, extension: { keep: true }, sessions: [
    { id: 'history', date: '2020-01-01', scheduleState: 'active', teacherNote: 'Historical content unchanged' },
    { id: 'original', sessionKey: 'original', date: request.cancel_date, scheduleState: 'active', state: 'active',
      isForced: false, originalDate: '', makeupDate: '', billingId: 'oct', billingLabel: '10월', sessionNumber: 1,
      startTime: '18:00', endTime: '20:00', teacherCatalogId: id(9), classroomCatalogId: id(8),
      teacherNote: 'Original exception retained', textbookEntries: [{ textbookId: 'book', actual: { start: 8, end: 10 } }], progressStatus: 'done' },
  ] };

export function approvalDbFixture() {
  const after = buildLegacyMakeupApprovalPlan(plan, request, { teacher, classrooms: [room] });
  const baseline = applyMakeupRequestToSchedulePlan(plan, { name: request.class_name, subject: '영어', schedule: '금 18:00-20:00' }, request);
  delete baseline.generatedAt;
  delete baseline.history;
  const events = buildMakeupCalendarDrafts(request).map((draft, index) => {
    const mutation = buildAcademicEventMutationPayload(draft, []);
    if (!mutation.isValid || !mutation.payload) throw new Error('Invalid synthetic calendar fixture');
    const payload = mutation.payload;
    return { id: id(100 + index), title: payload.title, date: payload.start || payload.start_date || payload.date,
      type: payload.type, grade: payload.grade || 'all', note: payload.note };
  });
  const cancel = events.find(event => extractMakeupCalendarMeta(event.note)?.kind === 'cancel');
  const makeups = events.filter(event => extractMakeupCalendarMeta(event.note)?.kind === 'makeup');
  const patch = { actor_profile_id: id(901), final_note: 'Synthetic approval regression', schedule_plan_before: plan,
    schedule_plan_after: after, cancel_academic_event_id: cancel.id,
    makeup_academic_event_id: makeups[0].id, makeup_academic_event_ids: makeups.map(event => event.id), calendar_events: events };
  return { request, plan, baseline, after, patch };
}

export function approvalDbFixtureSql() {
  return `-- Generated from the actual JS producers by tests/fixtures/makeup-approval-db-fixture.mjs.\n`
    + `create function pg_temp.fixture() returns jsonb language sql immutable as $fn$ select $json$${JSON.stringify(approvalDbFixture())}$json$::jsonb $fn$;\n`;
}
