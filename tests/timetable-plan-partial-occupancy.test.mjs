import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { createTimetablePlanService } from '../src/features/academic/timetable-plan-service.ts';
import { createTimetablePlanController } from '../src/features/academic/timetable-plan-model.ts';
import { findOperatingConflicts } from '../src/features/academic/timetable-conflicts.ts';

const plan = { id: 'plan', name: '다음 학기', state: 'draft', metaRevision: 0, changeSequence: 0, targetStartDate: null, targetEndDate: null };
const item = { id: 'item', planId: plan.id, revision: 1, name: '합성 수업', subject: '영어', subjectAreaKey: null, grade: '중1', capacity: null, tuition: null, defaultTeacherId: null, defaultClassroomId: null, durationMinutes: null, sourceClassId: null, state: 'draft', appliedClassId: null, appliedTransferId: null, appliedAt: null, pendingSlots: [] };
const slot = { id: 'slot', itemId: item.id, planId: plan.id, weekday: 1, startMinute: 600, endMinute: 650, teacherId: 'teacher', classroomId: 'room' };
const base = { plan, items: [item], slots: [slot], appliedSnapshots: [], members: [], permissions: { canManage: true, canEdit: true, canTransfer: true }, capacity: { itemCount: 1, slotCount: 1, maxItems: 500, maxSlots: 2000, exceeded: false }, occupancyValidationVersion: 2, asOfDate: '2026-10-12', shadowSlots: [], shadowClasses: [], catalogs: { teachers: [], classrooms: [] }, unresolvedOccupancies: [], shadowFingerprint: 'weekly', datedSessions: [], datedUnresolvedOccupancies: [], datedFingerprint: 'dated', datedComplete: false, complete: true };
const blocker = { classId: 'legacy', label: '시간 확인 필요', scope: 'all', resourceId: null, reason: 'incomplete_read', date: '2026-10-12', teacherId: 'teacher', classroomId: 'room', occupancyFingerprint: 'partial' };
const period = { startDate: '2026-10-12', endDate: '2026-10-18' };

function serviceFor(snapshot) {
  let calls = 0;
  const client = createClient('https://timetable.example.invalid', 'fixture-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async () => { calls++; return Response.json(snapshot); } },
  });
  return { service: createTimetablePlanService({ client, actorScope: 'admin' }), calls: () => calls };
}

// The final operating-reference producer preserves independently nullable
// startMinute/endMinute on incomplete legacy rows. Consume that wire shape.
for (const bounds of [{ startMinute: 1020, endMinute: null }, { startMinute: null, endMinute: 1080 }, { startMinute: null, endMinute: 0 }]) {
  test(`HTTP 200 partial dated occupancy ${JSON.stringify(bounds)} loads and still reserves the whole known day`, async () => {
    const wire = { ...base, datedUnresolvedOccupancies: [{ ...blocker, ...bounds }] };
    const { service, calls } = serviceFor(wire);
    const controller = createTimetablePlanController({ service, actorScope: 'admin', planId: plan.id, storage: null });
    try {
      await controller.load();
      assert.equal(controller.snapshot().error, null);
      assert.equal(controller.snapshot().referenceStatus, 'verified');
      const loaded = controller.snapshot().snapshot;
      assert.equal(loaded.items[0].name, item.name);
      assert.deepEqual(loaded.datedUnresolvedOccupancies[0], wire.datedUnresolvedOccupancies[0]);
      assert.equal(findOperatingConflicts([slot], loaded, period)[0].kind, 'unresolved');
      assert.equal(findOperatingConflicts([{ ...slot, weekday: 2 }], loaded, period).length, 0);
      assert.equal(calls(), 1);
    } finally { controller.destroy(); }
  });
}

test('partial weekly occupancy loads without allowing same-day placement', async () => {
  const wire = { ...base, unresolvedOccupancies: [{ ...blocker, weekday: 1, startMinute: null, endMinute: 1080 }] };
  const loaded = await serviceFor(wire).service.readPlan(plan.id);
  assert.equal(findOperatingConflicts([slot], loaded)[0].kind, 'unresolved');
});

test('malformed time bounds continue to reject the entire reference', async () => {
  for (const bounds of [
    { startMinute: -1, endMinute: null }, { startMinute: 1440, endMinute: null },
    { startMinute: null, endMinute: -1 }, { startMinute: null, endMinute: 1441 },
    { startMinute: 1020.5, endMinute: null }, { startMinute: null, endMinute: '1080' },
    { startMinute: 1080, endMinute: 1020 }, { startMinute: 1080, endMinute: 1080 },
  ]) {
    const wire = { ...base, datedUnresolvedOccupancies: [{ ...blocker, ...bounds }] };
    await assert.rejects(serviceFor(wire).service.readPlan(plan.id), /timetable_plan_response_invalid/);
  }
});
