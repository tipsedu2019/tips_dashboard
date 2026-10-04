import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveEffectiveSchedule, effectiveInputForLesson, projectLegacyEffectivePlan, setLegacyLessonOverride, resetLegacyLessonToBasics } from '../src/features/operations/legacy-effective-schedule.js';
import { legacyLessonScheduleValidationError } from '../src/features/operations/schedule-only-plan.ts';
import { buildRoomAvailability, isEffectiveMakeupSchedule } from '../src/features/makeup-requests/makeup-request-model.js';

const fixtures = JSON.parse(await readFile(new URL('./fixtures/legacy-effective-schedule.json', import.meta.url), 'utf8'));
for (const fixture of fixtures) test(`shared production inheritance: ${fixture.name}`, () => {
  const original = structuredClone(fixture.input);
  assert.deepEqual(resolveEffectiveSchedule(fixture.input), fixture.expected);
  assert.deepEqual(fixture.input, original);
});
const input = fixtures[0].input;
const context = { version: 1, basicSlots: input.basicSlots, catalogs: input.catalogs, approvedByIdentity: {} };
const ordinary = () => ({ sessions: [{ ...input.session, teacherNote: 'Keep original content' }] });

test('display and validation inherit without serializing defaults; one field edit keeps other fields inherited', () => {
  const raw = ordinary(), before = structuredClone(raw);
  const display = projectLegacyEffectivePlan(raw, context);
  assert.deepEqual(raw, before);
  assert.equal(display.sessions[0].teacherCatalogId, 'teacher-a');
  assert.equal(display.sessions[0].date, raw.sessions[0].date);
  assert.equal(legacyLessonScheduleValidationError(raw, { sessions: [] }, '2026-10-04', context), '');
  const next = { ...display.sessions[0], classroomCatalogId: 'room-b' };
  const edited = setLegacyLessonOverride(raw, raw.sessions[0].date, next, display.sessions[0]);
  assert.deepEqual(edited.sessionSchedules[raw.sessions[0].date], { classroomCatalogId: 'room-b' });
  assert.deepEqual(edited.sessions, before.sessions);
  const newBasics = { ...context, basicSlots: context.basicSlots.map(s => ({ ...s, startTime: '13:00', teacherCatalogId: 'teacher-b' })) };
  const reloaded = projectLegacyEffectivePlan(edited, newBasics).sessions[0];
  assert.equal(reloaded.startTime, '13:00');
  assert.equal(reloaded.teacherCatalogId, 'teacher-b');
  assert.equal(reloaded.classroomCatalogId, 'room-b');
  assert.equal(reloaded.teacherNote, 'Keep original content');
});

test('stored explicit fields survive unrelated edits; reset is an explicit empty date override', () => {
  const raw = ordinary();
  Object.assign(raw.sessions[0], { startTime: '18:00', endTime: '20:00', teacherCatalogId: 'teacher-b', classroomCatalogId: 'room-b' });
  const display = projectLegacyEffectivePlan(raw, context).sessions[0];
  const edited = setLegacyLessonOverride(raw, display.date, { ...display, endTime: '21:00' }, display);
  assert.deepEqual(edited.sessionSchedules[display.date], { startTime: '18:00', endTime: '21:00', teacherCatalogId: 'teacher-b', classroomCatalogId: 'room-b' });
  const reset = resetLegacyLessonToBasics(edited, display.date);
  assert.deepEqual(reset.sessionSchedules[display.date], {});
  assert.equal(projectLegacyEffectivePlan(reset, context).sessions[0].startTime, '15:30');
  assert.equal(raw.sessions[0].startTime, '18:00', 'reset does not mutate stored snapshot');
});

test('explicit clears remain unknown and fail validation while absent parts inherit', () => {
  for (const empty of [null, '']) {
    const raw = ordinary();
    raw.sessionSchedules = { [raw.sessions[0].date]: { classroomCatalogId: empty } };
    const projected = projectLegacyEffectivePlan(raw, context).sessions[0];
    assert.equal(projected.startTime, '15:30');
    assert.equal(projected.classroomCatalogId, null);
    assert.match(legacyLessonScheduleValidationError(raw, { sessions: [] }, '2026-10-04', context), /선생님·강의실/);
  }
});

test('source binding survives content edits, rejects schedule identity edits, and never moves makeup dates', () => {
  const raw = ordinary(), lesson = raw.sessions[0];
  const source = { binding: { id: lesson.id, date: lesson.date, scheduleState: 'active' }, approvedOverride: { startTime: '21:00', endTime: '23:00' }, approvedOverrideVerified: true };
  const ctx = { ...context, approvedByIdentity: { [lesson.id]: source } };
  assert.equal(projectLegacyEffectivePlan(raw, ctx).sessions[0].startTime, '21:00');
  const content = { ...lesson, teacherNote: 'Updated content' };
  assert.equal(effectiveInputForLesson({ sessions: [content] }, content, ctx).approvedOverrideVerified, true);
  const moved = { ...lesson, date: '2026-10-03' };
  assert.equal(effectiveInputForLesson({ sessions: [moved] }, moved, ctx).approvedOverride, undefined);
  assert.equal(projectLegacyEffectivePlan({ sessions: [moved] }, ctx).sessions[0].date, '2026-10-03');
});

const target = (start = '18:00', end = '20:00') => [{ startAt: `2026-10-03T${start}:00+09:00`, endAt: `2026-10-03T${end}:00+09:00`, classroom: 'R' }];
const occupancyRow = patch => ({ id: 'dated-row', classId: 'class', className: 'Synthetic class', date: '2026-10-03', startMinute: 990, endMinute: 1080, classroom: null, uncertain: true, allRooms: true, ...patch });
const collisions = (rows, slots = target()) => buildRoomAvailability({ classrooms: [{ id: 'room', name: 'R' }], classes: [], requests: [], academicEvents: [], slots, effectiveSchedule: { version: 1, occupancies: rows } }).filter(r => r.name === 'R').flatMap(r => r.collisions);

test('wire collision consumer retains known time for unknown room, exact date and real conflict decisions', () => {
  assert.equal(collisions([occupancyRow({})]).length, 0, '16:30–18:00 unknown room does not overlap 18:00 start');
  assert.equal(collisions([occupancyRow({ endMinute: 1081 })]).length, 1);
  assert.equal(collisions([occupancyRow({ date: '2026-10-02', endMinute: 1200 })]).length, 0);
  assert.equal(collisions([occupancyRow({ classroom: 'Other', allRooms: false, startMinute: 1080, endMinute: 1200 })]).length, 0);
  assert.equal(collisions([occupancyRow({ classroom: 'R', allRooms: false, startMinute: 1080, endMinute: 1200, uncertain: false })]).length, 1);
  assert.equal(collisions([occupancyRow({ startMinute: null, endMinute: null })]).length, 1, 'unknown range fails closed');
  assert.equal(collisions([], target()).length, 0, 'cancelled rows contribute no occupancy');
  assert.equal(collisions([occupancyRow({ classroom: 'R', allRooms: false, startMinute: 1380, endMinute: 1440 })], [{ startAt: '2026-10-03T23:00:00+09:00', endAt: '2026-10-04T00:00:00+09:00', classroom: 'R' }]).length, 1);
});

test('effective wire contract rejects malformed bounds and accepts unknown components', () => {
  assert.ok(isEffectiveMakeupSchedule({ version: 1, occupancies: [occupancyRow({})] }));
  for (const row of [occupancyRow({ startMinute: -1 }), occupancyRow({ endMinute: 1441 }), occupancyRow({ allRooms: 'yes' }), occupancyRow({ startMinute: 1100 }), occupancyRow({ date: '2026-02-30' })]) {
    assert.equal(isEffectiveMakeupSchedule({ version: 1, occupancies: [row] }), false);
  }
});

test('an unknown date retains independently explicit bounds without inheriting defaults', () => {
  const result = resolveEffectiveSchedule({ ...input, session: { id: 'bad-date-known-range', date: 'not-a-date', startTime: '09:00', endTime: '10:00', classroomName: '기본 강의실' } });
  assert.equal(result.kind, 'unresolved');
  assert.deepEqual(result.errors, ['invalid_date']);
  assert.equal(result.values.startTime, '09:00');
  assert.equal(result.values.endTime, '10:00');
  assert.equal(result.values.classroomCatalogId, 'room-a');
  assert.equal(result.values.teacherCatalogId, null, 'invalid date has no inherited slot');
});
