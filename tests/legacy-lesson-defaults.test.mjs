import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotNewLegacyLessonDetails } from '../src/features/operations/legacy-lesson-defaults.ts';
import { normalizeSchedulePlan } from '../src/lib/class-schedule-planner.js';

const defaults = {
  schedule: '화목 17:00-19:00', teacher: '합성 강사', room: '별관 2강',
  teacherCatalogs: [{ id: 'teacher-1', name: '합성 강사', isVisible: true }],
  classroomCatalogs: [{ id: 'room-1', name: '별관 2강', isVisible: true }],
};
const occupancy = {
  startTime: '17:00', endTime: '19:00', teacherCatalogId: 'teacher-1',
  classroomCatalogId: 'room-1',
};
const regular = (date, extra = {}) => ({ id: `lesson:${date}`, date, scheduleState: 'active', isForced: false, ...extra });
const added = (date = '2026-10-01', extra = {}, settings = defaults, map = undefined) =>
  snapshotNewLegacyLessonDetails({ sessions: [regular(date, extra)], ...(map ? { sessionSchedules: map } : {}) }, { sessions: [] }, settings);
const emptyOccupancy = { startTime: '', endTime: '', teacherCatalogId: '', classroomCatalogId: '' };
const occupancyFields = [...Object.keys(occupancy), 'teacherName', 'classroomName'];
const details = row => Object.fromEntries(occupancyFields.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));

test('new October 1 and 29 get snapshots while seven stored October lessons and September remain unchanged', () => {
  const september = [
    regular('2026-09-24', { scheduleState: 'exception', memo: '보존 휴강', teacherNote: '보존 학습 기록' }),
    regular('2026-09-29', { startTime: '16:00', endTime: '18:00', teacherName: '당시 강사', classroomName: '당시 강의실' }),
  ];
  const october = ['06', '08', '13', '15', '20', '22', '27'].map(day => regular(`2026-10-${day}`, {
    ...occupancy, teacherNote: `보존 기록 ${day}`, textbookEntries: [{ textbookId: 'synthetic-book', planStart: day }],
  }));
  const previous = { sessions: [...september, ...october], sessionSchedules: {} };
  const plan = { ...previous, sessions: [...previous.sessions, regular('2026-10-01'), regular('2026-10-29')] };
  const untouched = structuredClone(plan);
  const result = snapshotNewLegacyLessonDetails(plan, previous, defaults);
  assert.deepEqual(plan, untouched, 'draft input must not be mutated');
  assert.deepEqual(result.sessions.slice(0, 9), previous.sessions);
  result.sessions.slice(0, 9).forEach((row, index) => assert.equal(row, previous.sessions[index]));
  assert.deepEqual(result.sessions.filter(row => row.date.startsWith('2026-10')).map(row => row.date).sort(),
    ['2026-10-01', '2026-10-06', '2026-10-08', '2026-10-13', '2026-10-15', '2026-10-20', '2026-10-22', '2026-10-27', '2026-10-29']);
  for (const date of ['2026-10-01', '2026-10-29']) {
    assert.deepEqual(details(result.sessions.find(row => row.date === date)), occupancy);
    assert.deepEqual(result.sessionSchedules[date], occupancy);
  }
  assert.equal(result.sessionSchedules['2026-09-29'], undefined);
  assert.equal(result.sessionSchedules['2026-10-06'], undefined);
});

test('snapshots survive real planner normalization and remain stable when defaults change', () => {
  const raw = {
    selectedDays: [2, 4], billingPeriods: [{ id: 'october', month: 10, startDate: '2026-10-01', endDate: '2026-10-29' }],
    sessions: [], sessionSchedules: {},
  };
  const generated = normalizeSchedulePlan(raw, defaults);
  const captured = snapshotNewLegacyLessonDetails(generated, raw, defaults);
  const normalized = normalizeSchedulePlan(captured, defaults);
  assert.equal(normalized.sessions.length, 9);
  normalized.sessions.forEach(row => assert.deepEqual(details(row), occupancy));
  const changed = snapshotNewLegacyLessonDetails(normalized, captured, { ...defaults, schedule: '화목 18:00-20:00', teacher: '새 강사', room: '다른 강의실' });
  assert.deepEqual(changed.sessions, normalized.sessions);
  assert.deepEqual(changed.sessionSchedules, normalized.sessionSchedules);
});

test('expanding the actual seven-lesson October period captures only October 1 and 29', () => {
  const raw = {
    selectedDays: [2, 4],
    billingPeriods: [
      { id: 'september', month: 9, startDate: '2026-09-01', endDate: '2026-09-29' },
      { id: 'october', month: 10, startDate: '2026-10-02', endDate: '2026-10-27' },
    ],
    sessionStates: { '2026-09-24': { state: 'exception', memo: '보존 휴강' } },
    sessions: [],
  };
  const previous = normalizeSchedulePlan(raw, defaults);
  const existingOctober = previous.sessions.filter(row => row.billingId === 'october');
  assert.equal(existingOctober.length, 7);
  const generated = normalizeSchedulePlan({ ...previous, billingPeriods: previous.billingPeriods.map(period =>
    period.id === 'october' ? { ...period, startDate: '2026-10-01', endDate: '2026-10-29' } : period) }, defaults);
  const captured = snapshotNewLegacyLessonDetails(generated, previous, defaults);
  assert.equal(captured.sessions.filter(row => row.billingId === 'october').length, 9);
  for (const previousRow of previous.sessions) {
    const current = captured.sessions.find(row => row.date === previousRow.date);
    assert.equal(current.id, previousRow.id);
    assert.deepEqual(details(current), {});
    assert.equal(current, generated.sessions.find(row => row.date === previousRow.date));
  }
  assert.equal(captured.sessions.find(row => row.date === '2026-09-24').scheduleState, 'exception');
  assert.equal(captured.sessions.find(row => row.date === '2026-09-29').scheduleState, 'active');
  for (const date of ['2026-10-01', '2026-10-29']) assert.deepEqual(details(captured.sessions.find(row => row.date === date)), occupancy);
  assert.deepEqual(Object.keys(captured.sessionSchedules).sort(), ['2026-10-01', '2026-10-29']);
});

test('existing identity or date prevents recapturing old date-only lessons', () => {
  const previous = { sessions: [regular('2026-10-06'), regular('2026-10-08')] };
  const sameDate = regular('2026-10-06', { id: 'regenerated-id' });
  const movedIdentity = { ...previous.sessions[1], date: '2026-10-29' };
  const plan = { sessions: [sameDate, movedIdentity] };
  assert.deepEqual(snapshotNewLegacyLessonDetails(plan, previous, defaults), plan);
});

for (const extra of [{ startTime: '16:00' }, { teacherCatalogId: '' }, { classroomName: null }]) {
  test(`explicit row override is never backfilled: ${JSON.stringify(extra)}`, () => {
    const result = added('2026-10-01', extra);
    assert.deepEqual(details(result.sessions[0]), extra);
    assert.equal(result.sessionSchedules?.['2026-10-01'], undefined);
  });
}
for (const override of [{ startTime: '16:00' }, { teacherCatalogId: '' }, { classroomCatalogId: null }]) {
  test(`explicit date override is never backfilled: ${JSON.stringify(override)}`, () => {
    const result = added('2026-10-01', {}, defaults, { '2026-10-01': override });
    assert.deepEqual(result.sessionSchedules['2026-10-01'], override);
    assert.deepEqual(details(result.sessions[0]), {});
  });
}

test('an empty date schedule or undefined-only fields cannot suppress a new snapshot', () => {
  for (const override of [{}, { startTime: undefined }, { teacherCatalogId: undefined, memo: '보존할 별도 정보' }]) {
    const result = added('2026-10-01', { endTime: undefined }, defaults, { '2026-10-01': override });
    assert.deepEqual(details(result.sessions[0]), occupancy);
    assert.deepEqual(result.sessionSchedules['2026-10-01'], { ...override, ...occupancy });
  }
});

test('a null or blank date override still wins even alongside undefined fields', () => {
  for (const override of [{ startTime: undefined, teacherCatalogId: '' }, { teacherCatalogId: null, endTime: undefined }]) {
    const result = added('2026-10-01', {}, defaults, { '2026-10-01': override });
    assert.deepEqual(result.sessionSchedules['2026-10-01'], override);
    assert.deepEqual(details(result.sessions[0]), {});
  }
});

test('different weekdays use their own explicit resources and times', () => {
  const settings = {
    schedule: '화 17:00-19:00 (화요일 강사, 별관 2강)\n목 18:00-20:00 (목요일 강사, 본관 3강)',
    teacher: '목요일 강사, 화요일 강사', room: '본관 3강, 별관 2강',
    teacherCatalogs: [{ id: 'tue', name: '화요일 강사' }, { id: 'thu', name: '목요일 강사' }],
    classroomCatalogs: [{ id: 'annex', name: '별관 2강' }, { id: 'main', name: '본관 3강' }],
  };
  assert.deepEqual(details(added('2026-10-01', {}, settings).sessions[0]), {
    startTime: '18:00', endTime: '20:00', teacherCatalogId: 'thu', classroomCatalogId: 'main',
      });
  assert.deepEqual(details(added('2026-10-06', {}, settings).sessions[0]), {
    startTime: '17:00', endTime: '19:00', teacherCatalogId: 'tue', classroomCatalogId: 'annex',
      });
});

test('day-tagged rooms resolve by weekday rather than list position', () => {
  const settings = { ...defaults, room: '본관 3강(목), 별관 2강(화)',
    classroomCatalogs: [...defaults.classroomCatalogs, { id: 'room-3', name: '본관 3강' }] };
  assert.equal(added('2026-10-06', {}, settings).sessions[0].classroomCatalogId, 'room-1');
  assert.equal(added('2026-10-01', {}, settings).sessions[0].classroomCatalogId, 'room-3');
});

test('teacher-only schedule detail and independently tagged classroom remain matched to the day', () => {
  const settings = { ...defaults, schedule: '화목 17:00-19:00 (합성 강사)', teacher: '다른 강사, 합성 강사',
    room: '본관 3강(목), 별관 2강(화)', classroomCatalogs: [...defaults.classroomCatalogs, { id: 'room-3', name: '본관 3강' }] };
  assert.deepEqual(details(added('2026-10-01', {}, settings).sessions[0]), { ...occupancy, classroomCatalogId: 'room-3' });
});

test('canonical single-hour times are stored in validated padded format', () => {
  assert.deepEqual(details(added('2026-10-01', {}, { ...defaults, schedule: '화목 9:00-11:00' }).sessions[0]),
    { ...occupancy, startTime: '09:00', endTime: '11:00' });
});

test('whitespace-only resource spelling differences match a unique visible catalog', () => {
  assert.deepEqual(details(added('2026-10-01', {}, { ...defaults, teacher: '합성강사', room: '별관2강' }).sessions[0]), occupancy);
});

for (const settings of [
  { ...defaults, schedule: '목 17:00-19:00\n목 19:00-21:00' },
  { ...defaults, schedule: '수 17:00-19:00' },
  { ...defaults, schedule: '목 25:00-27:00' },
  { ...defaults, schedule: '목 19:00-17:00' },
  { ...defaults, schedule: '목 17:00-19:00 (, )' },
  { ...defaults, schedule: '목 17:00-19:00 (합성 강사, )' },
  { ...defaults, teacher: '합성 강사, 다른 강사' },
  { ...defaults, room: '별관 2강, 본관 3강' },
  { ...defaults, room: '별관 2강(화)' },
  { ...defaults, room: '별관 2강(목), 본관 3강(목)' },
  { ...defaults, teacherCatalogs: [] },
  { ...defaults, classroomCatalogs: [{ id: 'room-1', name: '별관 2강', isVisible: false }] },
  { ...defaults, teacherCatalogs: [{ id: 'teacher-1', name: '합성 강사' }, { id: 'teacher-2', name: '합성 강사' }] },
  { ...defaults, teacherCatalogs: [{ id: '', name: '합성 강사' }] },
  { ...defaults, teacherCatalogs: [{ id: 'teacher-1', name: '합성 강사' }, { id: 'teacher-1', name: '다른 강사' }] },
  { ...defaults, teacherCatalogs: [{ id: 'teacher-1', name: '합성 강사', is_visible: false }] },
  { ...defaults, classroomCatalogs: [{ id: 'room-1', name: '별관 2강' }, { id: 'room-2', name: '별관2강' }] },
  { ...defaults, schedule: '목 17:00-19:00\n금 시간 미정' },
]) {
  test(`missing or ambiguous defaults never guess occupancy: ${JSON.stringify(settings)}`, () => {
    assert.deepEqual(details(added('2026-10-01', {}, settings).sessions[0]), emptyOccupancy);
  });
}

test('multiple lessons on the same date never share an inferred date snapshot', () => {
  const plan = { sessions: [regular('2026-10-01'), regular('2026-10-01', { id: 'second' })] };
  const result = snapshotNewLegacyLessonDetails(plan, { sessions: [] }, defaults);
  result.sessions.forEach(row => assert.deepEqual(details(row), emptyOccupancy));
  assert.equal(result.sessionSchedules?.['2026-10-01'], undefined);
});

for (const extra of [{ scheduleState: 'exception' }, { scheduleState: 'tbd' }, { scheduleState: 'makeup' }, { isForced: true }, { originalDate: '2026-09-29' }]) {
  test(`non-regular lesson does not inherit weekday defaults: ${JSON.stringify(extra)}`, () => {
    assert.deepEqual(details(added('2026-10-01', extra).sessions[0]), {});
  });
}
for (const date of ['2026-10-02', '2026-02-30', '2026-10-01T17:00:00', 'invalid']) {
  test(`unmatched or invalid dates are left for validation: ${date}`, () => {
    assert.deepEqual(details(added(date).sessions[0]), emptyOccupancy);
  });
}
