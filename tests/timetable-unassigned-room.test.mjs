import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEffectiveSchedule, projectLegacyEffectivePlan } from '../src/features/operations/legacy-effective-schedule.js';
import { legacyLessonScheduleValidationError } from '../src/features/operations/schedule-only-plan.ts';
import { effectiveOperatingSlots, findOperatingConflicts } from '../src/features/academic/timetable-conflicts.ts';
import { requireTimetableOperatingReference } from '../src/features/academic/timetable-plan-service.ts';
import { buildPlanPanels } from '../src/features/academic/timetable-plan-interaction.ts';

const catalogs = { teachers: [{ id: 'teacher-a', name: 'Teacher A' }], rooms: [{ id: 'room-a', name: 'Room A' }, { id: 'room-b', name: 'Room B' }] };
const basic = { id: 'weekly', weekday: 2, startTime: '19:30', endTime: '21:30', teacherCatalogId: 'teacher-a', classroomCatalogId: null };
const session = { id: 'lesson', date: '2026-10-06', scheduleState: 'active' };
const context = { version: 1, basicSlots: [basic], catalogs, approvedByIdentity: {} };
const resolve = (patch = {}, slots = [basic]) => resolveEffectiveSchedule({ session: { ...session, ...patch }, basicSlots: slots, catalogs });

test('adding a lesson with an unassigned room preserves its teacher and interval and passes preflight', () => {
  const plan = { sessions: [session] };
  const before = structuredClone(plan);
  assert.equal(resolve().kind, 'resolved');
  assert.deepEqual(resolve().missing, []);
  const projected = projectLegacyEffectivePlan(plan, context).sessions[0];
  assert.equal(projected.teacherCatalogId, 'teacher-a');
  assert.equal(projected.startTime, '19:30');
  assert.equal(projected.classroomCatalogId, null);
  assert.equal(legacyLessonScheduleValidationError(plan, { sessions: [] }, '2026-10-01', context), '');
  assert.deepEqual(plan, before);
});

test('explicit room clears are valid, omission inherits, and unknown nonempty resources remain errors', () => {
  const assigned = [{ ...basic, classroomCatalogId: 'room-a' }];
  assert.equal(resolve({}, assigned).values.classroomCatalogId, 'room-a');
  for (const patch of [{ classroomCatalogId: null }, { classroomCatalogId: '' }, { classroomName: '' }, { classroomName: '강의실 미정' }, { classroomName: '미정' }]) {
    const actual = resolve(patch, assigned);
    assert.equal(actual.kind, 'resolved', JSON.stringify(patch));
    assert.equal(actual.values.classroomCatalogId, null);
  }
  for (const patch of [{ classroomCatalogId: 'missing-id' }, { classroomCatalogId: 7 }, { classroomName: 'Unknown room' }]) {
    assert.equal(resolve(patch).kind, 'unresolved', JSON.stringify(patch));
  }
  assert.equal(resolve({}, [{ ...basic, classroomUnresolved: true }]).kind, 'unresolved');
  assert.equal(resolve({ classroomCatalogId: null }, [{ ...basic, classroomUnresolved: true }]).kind, 'resolved');
  assert.equal(resolve({ date: '2026-10-07' }, [{ ...basic, classroomCatalogId: 'room-a' }, { ...basic, id: 'other', weekday: 4, classroomCatalogId: 'room-b' }]).kind, 'unresolved');
});

test('teacher, valid time, date and unique identity remain required with no room', () => {
  for (const patch of [{ teacherCatalogId: null }, { startTime: '' }, { endTime: '18:00' }, { date: 'bad-date' }, { id: '' }]) {
    assert.equal(resolve(patch).kind, 'unresolved', JSON.stringify(patch));
  }
});

test('an invalid approved room and ambiguous placeholder catalog names are not unassigned rooms', () => {
  const approved = { ...basic, classroomCatalogId: null, classroomUnresolved: true };
  assert.equal(resolveEffectiveSchedule({ session, basicSlots: [basic], catalogs, approvedOverride: approved, approvedOverrideVerified: true }).kind, 'unresolved');
  const named = { ...catalogs, rooms: [{ id: 'room-a', name: '미정' }] };
  assert.equal(resolveEffectiveSchedule({ session: { ...session, classroomName: '미정' }, basicSlots: [basic], catalogs: named }).values.classroomCatalogId, 'room-a');
  assert.equal(resolveEffectiveSchedule({ session: { ...session, classroomName: '미정' }, basicSlots: [basic], catalogs: { ...named, rooms: [...named.rooms, { id: 'room-b', name: '미정' }] } }).kind, 'unresolved');
});

const candidate = { id: 'candidate', itemId: 'draft', planId: 'plan', weekday: 2, startMinute: 1170, endMinute: 1290, teacherId: 'teacher-b', classroomId: 'room-a', sourceSlotId: null };
const shadow = { id: 'weekly', classId: 'operating-class', sourceSlotId: null, weekday: 2, startMinute: 1170, endMinute: 1290, teacherId: 'teacher-a', classroomId: null, classRevision: 0 };
const reference = (extra = {}) => ({ occupancyValidationVersion: 2, asOfDate: '2026-10-01', shadowSlots: [shadow], shadowClasses: [], catalogs: { teachers: [], classrooms: [] }, unresolvedOccupancies: [], shadowFingerprint: 'f', datedSessions: [], datedUnresolvedOccupancies: [], datedFingerprint: 'd', datedComplete: true, complete: true, ...extra });

test('the real operating DTO accepts nullable rooms without dropping known teacher occupancy', () => {
  const loaded = requireTimetableOperatingReference(reference());
  assert.deepEqual(findOperatingConflicts([candidate], loaded), []);
  assert.deepEqual(findOperatingConflicts([{ ...candidate, teacherId: 'teacher-a' }], loaded).map(x => x.kind), ['teacher']);
  assert.deepEqual(findOperatingConflicts([candidate], reference({ shadowSlots: [{ ...shadow, classroomId: 'room-a' }] })).map(x => x.kind), ['classroom']);
});

test('dated unassigned rooms keep teacher conflicts and cancellation still removes occupancy', () => {
  const dated = { id: 'dated', classId: shadow.classId, sourceSlotId: null, date: '2026-10-06', state: 'makeup', startMinute: 1170, endMinute: 1290, teacherId: 'teacher-a', classroomId: null, revision: 0 };
  const ref = reference({ shadowSlots: [], datedSessions: [dated] });
  assert.equal(effectiveOperatingSlots(ref, dated.date).length, 1);
  const period = { startDate: '2026-10-01', endDate: '2026-10-31' };
  assert.deepEqual(findOperatingConflicts([candidate], ref, period), []);
  assert.deepEqual(findOperatingConflicts([{ ...candidate, teacherId: 'teacher-a' }], ref, period).map(x => x.kind), ['teacher']);
  assert.deepEqual(effectiveOperatingSlots({ ...ref, datedSessions: [{ ...dated, state: 'skipped' }] }, dated.date), []);
});

test('unassigned operating occupancy is absent from every preset grid', () => {
  const snapshot = {
    slots: [], items: [], appliedSnapshots:[], shadowSlots: [shadow],
    shadowClasses: [{ id: shadow.classId, name: 'Synthetic class', subject: '영어' }],
    catalogs: {
      teachers: [{ id: 'teacher-a', name: 'Teacher A', isVisible: true, subjects: ['영어팀'] }],
      classrooms: [{ id: 'room-a', name: 'Room A', isVisible: true }],
    },
  };
  for (const view of ['teacher-weekly', 'daily-teacher']) {
    const blocks = buildPlanPanels(snapshot, view).flatMap(panel => panel.blocks);
    assert.equal(blocks.length, 0);
  }
  for (const view of ['classroom-weekly', 'daily-classroom']) {
    assert.deepEqual(buildPlanPanels(snapshot, view).flatMap(panel => panel.blocks), []);
  }
});
