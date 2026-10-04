import { buildLegacyMakeupApprovalPlan } from '../../src/features/makeup-requests/makeup-approval-plan.js';
import { buildMakeupCalendarDrafts, extractMakeupCalendarMeta } from '../../src/features/makeup-requests/makeup-request-model.js';
import { buildAcademicEventMutationPayload } from '../../src/features/operations/academic-event-utils.js';

export const effectiveId = n => `ae041004-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = effectiveId(901);
const teacher = n => ({ id: effectiveId(n), name: `Inheritance teacher ${n}` });
const room = n => ({ id: effectiveId(n), name: `Inheritance room ${n}` });
const shapes = [
  [1, '2026-10-16', '2026-10-15', '15:00', '17:00', '금 10:00-11:00'],
  [2, '2026-10-12', '2026-10-09', '13:00', '15:00', '월 10:00-11:00'],
  [3, '2026-10-15', '2026-10-02', '21:30', '23:30', '목 10:00-11:00'],
  [4, '2026-10-14', '2026-10-03', '18:00', '20:00', '수 10:00-11:00'],
  [5, '2026-10-14', '2026-10-15', '15:00', '17:00', '수 19:30-21:30'],
  [6, '2026-10-14', '2026-10-15', '23:00', '00:00', '수 19:30-21:30'],
];

export function effectiveApprovalFixtures() {
  return shapes.map(([n, cancelDate, date, start, end, schedule]) => {
    const t = teacher(n >= 5 ? 2 : 1), r = room(n >= 5 ? 12 : 11);
    const endDate = n === 6 ? '2026-10-16' : date;
    const request = { id: effectiveId(100+n), class_id: effectiveId(200+n), class_name: `Inheritance approval ${n}`,
      subject: '영어', request_kind: 'cancel_makeup', cancel_date: cancelDate, teacher_catalog_id: t.id,
      makeup_start_at: `${date}T${start}:00+09:00`, makeup_end_at: `${endDate}T${end}:00+09:00`, makeup_classroom: r.name,
      makeup_slots: [{ startAt: `${date}T${start}:00+09:00`, endAt: `${endDate}T${end}:00+09:00`, classroom: r.name }] };
    const plan = { sessions: [{ id: `original-${n}`, sessionKey: `original-${n}`, date: cancelDate,
      state: 'active', scheduleState: 'active', isForced: false, originalDate: '', makeupDate: '',
      teacherNote: 'Synthetic content must remain', textbookEntries: [{ textbookId: 'synthetic-book', actual: { start: 1, end: 3 } }] }], sessionStates: {} };
    const after = buildLegacyMakeupApprovalPlan(plan, request, { teacher: t, classrooms: [r] });
    if (n >= 5) {
      // Reproduce a historical approved makeup whose raw row omitted all six
      // resource/time keys. The approved request/calendar remain authoritative.
      const row = after.sessions.find(s => s.scheduleState === 'makeup');
      for (const key of ['startTime', 'endTime', 'teacherCatalogId', 'teacherName', 'classroomCatalogId', 'classroomName', 'makeupRequestId']) delete row[key];
      row.id = row.sessionKey = n === 5 ? 'historical-approved-makeup' : 'historical-midnight-makeup';
    }
    const events = buildMakeupCalendarDrafts(request).map((draft, index) => {
      const mutation = buildAcademicEventMutationPayload(draft, []);
      if (!mutation.isValid || !mutation.payload) throw new Error('Invalid synthetic calendar');
      const p = mutation.payload;
      return { id: effectiveId(1000+n*10+index), title: p.title, date: p.start || p.start_date || p.date, type: p.type, grade: p.grade || 'all', note: p.note };
    });
    const cancel = events.find(e => extractMakeupCalendarMeta(e.note)?.kind === 'cancel');
    const makeups = events.filter(e => extractMakeupCalendarMeta(e.note)?.kind === 'makeup');
    return { n, schedule, teacher: t, room: r, request, plan, after, patch: { actor_profile_id: actor, final_note: 'Synthetic inheritance integration',
      schedule_plan_before: plan, schedule_plan_after: after, cancel_academic_event_id: cancel.id,
      makeup_academic_event_id: makeups[0].id, makeup_academic_event_ids: makeups.map(e => e.id), calendar_events: events } };
  });
}

export function effectiveApprovalFixtureSql() {
  return `-- BEGIN EFFECTIVE APPROVAL PRODUCER FIXTURE\ncreate function pg_temp.effective_approvals() returns jsonb language sql immutable as $f$ select $effective_approvals$${JSON.stringify(effectiveApprovalFixtures())}$effective_approvals$::jsonb $f$;\n-- END EFFECTIVE APPROVAL PRODUCER FIXTURE\n`;
}
