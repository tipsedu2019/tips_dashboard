import test from 'node:test';
import assert from 'node:assert/strict';

import { applyCalendarDateToggle, buildSchedulePlanForSave, normalizeSchedulePlan } from '../src/lib/class-schedule-planner.js';
import { legacyLessonScheduleValidationError, preserveScheduleLearningContent, preserveUneditedLegacyPeriods } from '../src/features/operations/schedule-only-plan.ts';

const helperSource = new URL(process.env.LEGACY_DEFAULTS_RECOVERY_SOURCE || '../src/features/operations/legacy-lesson-defaults.ts', import.meta.url);
const helpers = await import(helperSource.href);
const resolve = (...args) => {
  assert.equal(typeof helpers.resolveLegacyLessonDetails, 'function');
  return helpers.resolveLegacyLessonDetails(...args);
};
const recover = (...args) => {
  assert.equal(typeof helpers.snapshotRestoredLegacyLessonDetails, 'function');
  return helpers.snapshotRestoredLegacyLessonDetails(...args);
};
const fields = ['startTime', 'endTime', 'teacherCatalogId', 'classroomCatalogId', 'teacherName', 'classroomName'];
const details = row => Object.fromEntries(fields.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));
const defaults = {
  schedule: '화목 17:00-19:00 (합성 강사A, 별관 2강)\n금 19:00-21:00 (합성 강사B, 본관 3강)',
  teacher: '합성 강사B, 합성 강사A', room: '본관 3강, 별관 2강',
  teacherCatalogs: [{ id: 'synthetic-teacher-a', name: '합성 강사A' }, { id: 'synthetic-teacher-b', name: '합성 강사B' }],
  classroomCatalogs: [{ id: 'synthetic-room-2', name: '별관 2강' }, { id: 'synthetic-room-3', name: '본관 3강' }],
};
const occupancy = { startTime: '17:00', endTime: '19:00', teacherCatalogId: 'synthetic-teacher-a', classroomCatalogId: 'synthetic-room-2' };

// Persisted-shape synthetic fixture: all nine October dates exist, October 1
// is skipped and October 29 active. No actual class/student/content data.
function fixture(state = 'skipped') {
  const previous = buildSchedulePlanForSave({
    selectedDays: [2, 4],
    billingPeriods: [
      { id: 'synthetic-september', month: 9, startDate: '2026-09-01', endDate: '2026-09-29' },
      { id: 'synthetic-october', month: 10, startDate: '2026-10-01', endDate: '2026-10-29' },
    ],
    sessionStates: { '2026-09-24': { state: 'exception' }, '2026-10-01': { state } },
    sessionSchedules: {},
  });
  previous.sessions = previous.sessions.map(row => ({ ...row, id: `persisted:${row.date}`, sessionKey: `key:${row.date}`, teacherNote: `SYNTHETIC history ${row.date}` }));
  const states = { ...previous.sessionStates }; delete states['2026-10-01'];
  const plan = { ...previous, sessionStates: states, sessions: previous.sessions.map(row => row.date === '2026-10-01' ? { ...row, scheduleState: 'active', state: 'active', isForced: false, sessionNumber: 1 } : row) };
  return { previous, plan };
}

test('date resolver uses the exact multiline weekday and catalog resources', () => {
  assert.deepEqual(resolve('2026-10-01', defaults), occupancy);
  assert.deepEqual(resolve('2026-10-06', defaults), occupancy);
  assert.deepEqual(resolve('2026-10-02', defaults), { startTime: '19:00', endTime: '21:00', teacherCatalogId: 'synthetic-teacher-b', classroomCatalogId: 'synthetic-room-3' });
  assert.equal(resolve('2026-10-05', defaults), null);
  assert.equal(resolve('2026-02-30', defaults), null);
});

test('date resolver requires complete unique defaults and never chooses an ambiguous resource', () => {
  for (const settings of [
    { ...defaults, schedule: '목 17:00-19:00\n목 19:00-21:00' },
    { ...defaults, schedule: '목 17:00-19:00\n월 시간 미정' },
    { ...defaults, schedule: '목 19:00-17:00' },
    { ...defaults, schedule: '목 17:00-19:00', teacher: '합성 강사A, 합성 강사B' },
    { ...defaults, teacherCatalogs: [...defaults.teacherCatalogs, { id: 'duplicate', name: '합성 강사A' }] },
    { ...defaults, classroomCatalogs: [{ id: 'synthetic-room-2', name: '별관 2강', isVisible: false }] },
    { ...defaults, teacherCatalogs: [] },
  ]) assert.equal(resolve('2026-10-01', settings), null, JSON.stringify(settings));
});

for (const state of ['skipped', 'exception', 'tbd']) test(`explicit ${state}-to-active recovery snapshots only the selected October 1`, () => {
  const { previous, plan } = fixture(state), before = structuredClone({ previous, plan });
  const result = recover(plan, previous, defaults, '2026-10-01');
  assert.notEqual(result, plan);
  assert.equal(result.sessions.length, 18);
  const restored = result.sessions.find(row => row.date === '2026-10-01');
  assert.deepEqual(details(restored), occupancy);
  assert.equal(restored.id, 'persisted:2026-10-01');
  assert.equal(restored.sessionKey, 'key:2026-10-01');
  assert.equal(restored.teacherNote, 'SYNTHETIC history 2026-10-01');
  assert.deepEqual(result.sessionSchedules['2026-10-01'], occupancy);
  assert.deepEqual(Object.keys(result.sessionSchedules), ['2026-10-01']);
  for (const row of plan.sessions.filter(row => row.date !== '2026-10-01')) {
    assert.equal(result.sessions.find(current => current.date === row.date), row, row.date);
    assert.deepEqual(details(row), {}, 'existing date-only lessons must not be backfilled');
  }
  assert.equal(result.sessions.find(row => row.date === '2026-09-24').scheduleState, 'exception');
  assert.equal(result.sessions.find(row => row.date === '2026-09-29').scheduleState, 'active');
  assert.equal(result.sessions.find(row => row.date === '2026-10-29').scheduleState, 'active');
  assert.deepEqual({ previous, plan }, before, 'recovery must not mutate either input');
});

for (const location of ['row', 'date']) test(`manual, null and blank ${location} overrides retain priority over recovery defaults`, () => {
  for (const field of fields) for (const value of ['manual-value', '', null]) {
    const { previous, plan } = fixture();
    if (location === 'row') Object.assign(plan.sessions.find(row => row.date === '2026-10-01'), { [field]: value });
    else plan.sessionSchedules = { '2026-10-01': { [field]: value } };
    const before = structuredClone(plan);
    assert.equal(recover(plan, previous, defaults, '2026-10-01'), plan, `${location}.${field}=${String(value)}`);
    assert.deepEqual(plan, before);
  }
});

test('unchanged normal history and unavailable defaults remain untouched', () => {
  const { previous, plan } = fixture();
  const normalPrevious = { ...previous, sessions: previous.sessions.map(row => row.date === '2026-10-01' ? { ...row, scheduleState: 'active', state: 'active' } : row) };
  assert.equal(recover(plan, normalPrevious, defaults, '2026-10-01'), plan);
  assert.equal(recover(previous, previous, defaults, '2026-10-01'), previous, 'reading a skipped row is not an operator restoration');
  assert.equal(recover(plan, previous, { ...defaults, teacherCatalogs: [] }, '2026-10-01'), plan);
  assert.equal(recover(plan, previous, defaults, '2026-10-06'), plan, 'the selected normal date does not trigger recovery elsewhere');
});

test('recovery rejects makeup, forced and linked lessons and unsupported prior states', () => {
  for (const patch of [{ scheduleState: 'makeup', state: 'makeup' }, { isForced: true }, { originalDate: '2026-09-29' }]) {
    const { previous, plan } = fixture();
    Object.assign(plan.sessions.find(row => row.date === '2026-10-01'), patch);
    assert.equal(recover(plan, previous, defaults, '2026-10-01'), plan, JSON.stringify(patch));
  }
  for (const state of ['active', 'makeup', 'force_active']) {
    const { previous, plan } = fixture();
    Object.assign(previous.sessions.find(row => row.date === '2026-10-01'), { scheduleState: state, state });
    assert.equal(recover(plan, previous, defaults, '2026-10-01'), plan, state);
  }
});

test('recovery requires one selected row in both current and previous plans', () => {
  for (const side of ['current', 'previous']) {
    const { previous, plan } = fixture(), target = side === 'current' ? plan : previous;
    target.sessions = [...target.sessions, { ...target.sessions.find(row => row.date === '2026-10-01'), id: 'duplicate' }];
    assert.equal(recover(plan, previous, defaults, '2026-10-01'), plan, side);
  }
  const { previous, plan } = fixture();
  assert.equal(recover(plan, { ...previous, sessions: previous.sessions.filter(row => row.date !== '2026-10-01') }, defaults, '2026-10-01'), plan);
  assert.equal(recover(plan, previous, defaults, '2026-10-31'), plan);
  for (const patch of [{ id: 'changed-identity' }, { id: '', sessionKey: '' }]) {
    const changed = { ...plan, sessions: plan.sessions.map(row => row.date === '2026-10-01' ? { ...row, ...patch } : row) };
    assert.equal(recover(changed, previous, defaults, '2026-10-01'), changed, 'restoration cannot replace or invent an existing identity');
  }
});

test('captured recovery stays stable when current defaults change', () => {
  const { previous, plan } = fixture();
  const captured = recover(plan, previous, defaults, '2026-10-01');
  assert.equal(recover(captured, previous, { ...defaults, schedule: '목 18:00-20:00' }, '2026-10-01'), captured);
  assert.deepEqual(details(captured.sessions.find(row => row.date === '2026-10-01')), occupancy);
});

test('actual planner serialization retains restored identity, other October lessons and September history', () => {
  const { previous } = fixture();
  const baseline = normalizeSchedulePlan(previous);
  const draft = normalizeSchedulePlan(applyCalendarDateToggle(baseline, '2026-10-01', { hasSession: true, hasBaseSession: true, isMakeup: false }));
  const captured = recover(draft, baseline, defaults, '2026-10-01');
  const serialized = buildSchedulePlanForSave(captured);
  const result = JSON.parse(JSON.stringify(preserveScheduleLearningContent(preserveUneditedLegacyPeriods(serialized, previous, baseline), previous)));
  assert.equal(legacyLessonScheduleValidationError(result, previous, '2026-10-02'), '');
  assert.equal(result.sessions.filter(row => row.billingId === 'synthetic-october' && row.scheduleState === 'active').length, 9);
  assert.deepEqual(details(result.sessions.find(row => row.date === '2026-10-01')), occupancy);
  for (const old of previous.sessions.filter(row => row.date !== '2026-10-01')) {
    const current = result.sessions.find(row => row.date === old.date);
    assert.equal(current.id, old.id, old.date);
    assert.equal(current.sessionKey, old.sessionKey, old.date);
    assert.equal(current.scheduleState, old.scheduleState, old.date);
    assert.equal(current.teacherNote, old.teacherNote, old.date);
    assert.deepEqual(details(current), details(old), old.date);
  }
  assert.deepEqual(result.sessions.filter(row => row.billingId === 'synthetic-september'), previous.sessions.filter(row => row.billingId === 'synthetic-september'));
});
