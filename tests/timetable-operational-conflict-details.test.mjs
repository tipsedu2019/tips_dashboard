import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTimetableOperationalConflictDetails } from '../src/features/academic/timetable-operational-conflict-details.ts';
import { timetableOperationalErrorMessage } from '../src/features/academic/timetable-operational-service.ts';

const fallback = '수업계획을 저장하지 못했습니다. 입력을 확인하고 다시 저장해 주세요.';
const privateDiagnostic = 'synthetic-secret SQL dashboard_private.internal_function class-id session-id';
const collision = (patch = {}) => ({
  className: '합성 겹친 수업', date: '2026-10-29',
  startMinute: 1050, endMinute: 1170,
  overlapStartMinute: 1050, overlapEndMinute: 1140,
  teacherName: '합성 담당', ...patch,
});
const uncertain = (patch = {}) => ({
  className: '합성 정보 누락 수업', date: '2026-10-29',
  missingFields: ['time', 'classroom'], ...patch,
});
const payload = ({ confirmed = [], unresolved = [], ...patch } = {}) => ({
  version: 1, confirmed, unresolved,
  confirmedCount: confirmed.length, unresolvedCount: unresolved.length,
  truncated: false, ...patch,
});
const failure = (detail, patch = {}) => ({
  code: '23P01', message: 'timetable_resource_conflict',
  details: JSON.stringify(detail), hint: privateDiagnostic, ...patch,
});
const parse = (detail) => parseTimetableOperationalConflictDetails(failure(detail));

function assertNoDiagnostic(value) {
  const serialized = JSON.stringify(value);
  for (const word of ['synthetic-secret', 'dashboard_private', 'internal_function', 'class-id', 'session-id']) {
    assert.equal(serialized.includes(word), false, `does not expose ${word}`);
  }
}

test('confirmed collisions identify only the evidenced teacher, classroom, or same-class overlap', () => {
  const base = collision({ teacherName: undefined });
  const examples = [
    ['teacher only', { teacherName: '합성 담당' }],
    ['classroom only', { classroomName: '합성 강의실' }],
    ['both resources', { teacherName: '합성 담당', classroomName: '합성 강의실' }],
    ['same class without resource labels', { sameClass: true }],
  ];
  for (const [name, evidence] of examples) {
    const detail = parse(payload({ confirmed: [{ ...base, ...evidence }] }));
    assert.deepEqual(detail, {
      confirmed: [{
        className: base.className, date: base.date,
        startMinute: 1050, endMinute: 1170,
        overlapStartMinute: 1050, overlapEndMinute: 1140,
        ...evidence,
      }],
      unresolved: [], confirmedCount: 1, unresolvedCount: 0, truncated: false,
    }, name);
    assert.equal(timetableOperationalErrorMessage(failure(payload({ confirmed: [{ ...base, ...evidence }] })), fallback),
      '겹치는 일정이 있어 저장하지 못했습니다. 입력은 유지되었습니다.');
  }
  assert.equal(parse(payload({ confirmed: [{ ...base, sameClass: false }] })), null,
    'a false sameClass flag supplies no collision evidence');
});

test('unresolved NULL wildcard stays an information gap and never becomes a confirmed collision', () => {
  const wildcard = uncertain({
    date: null, weekday: null, className: null,
    teacherName: null, classroomName: null,
    startMinute: null, endMinute: null,
    missingFields: ['date', 'time', 'teacher', 'classroom', 'lesson_identity', 'schedule'],
  });
  const detail = parse(payload({ unresolved: [wildcard] }));
  assert.deepEqual(detail, {
    confirmed: [], unresolved: [{ missingFields: wildcard.missingFields }],
    confirmedCount: 0, unresolvedCount: 1, truncated: false,
  });
  assert.equal(timetableOperationalErrorMessage(failure(payload({ unresolved: [wildcard] })), fallback),
    '정보가 부족한 일정이 있어 충돌 여부를 확인하지 못했습니다. 입력은 유지되었습니다.');
  assert.equal(parse(payload({ confirmed: [{ ...collision(), date: null, weekday: null }] })), null,
    'a wildcard date does not authorize confirmed output');
});

test('weekly evidence retains its weekday without inventing a dated occurrence', () => {
  const detail = parse(payload({
    confirmed: [collision({ date: null, weekday: 4 })],
    unresolved: [uncertain({ date: null, weekday: 2 })],
  }));
  assert.equal(detail.confirmed[0].weekday, 4);
  assert.equal(detail.unresolved[0].weekday, 2);
  assert.equal(Object.hasOwn(detail.confirmed[0], 'date'), false);
  assert.equal(Object.hasOwn(detail.unresolved[0], 'date'), false);
  assert.equal(timetableOperationalErrorMessage(failure(payload({
    confirmed: [collision({ date: null, weekday: 4 })], unresolved: [uncertain({ date: null, weekday: 2 })],
  })), fallback), '겹치는 일정과 정보가 부족한 일정이 있어 저장하지 못했습니다. 입력은 유지되었습니다.');
});

test('known dates take precedence over optional weekday metadata', () => {
  const detail = parse(payload({ confirmed: [collision({ weekday: 1 })] }));
  assert.equal(detail.confirmed[0].date, '2026-10-29');
  assert.equal(Object.hasOwn(detail.confirmed[0], 'weekday'), false);
});

test('reported totals survive bounded examples and make truncation explicit', () => {
  const detail = parse(payload({
    confirmed: [collision()], unresolved: [uncertain()],
    confirmedCount: 73, unresolvedCount: 21,
  }));
  assert.equal(detail.confirmedCount, 73);
  assert.equal(detail.unresolvedCount, 21);
  assert.equal(detail.confirmed.length, 1);
  assert.equal(detail.unresolved.length, 1);
  assert.equal(detail.truncated, true);
  assert.equal(parse(payload({ confirmed: [collision()], truncated: true })).truncated, true);
  assert.equal(parse(payload({ confirmed: [collision()], truncated: false })).truncated, false);
});

test('up to fifty representative entries are accepted and excess arrays are rejected', () => {
  for (const key of ['confirmed', 'unresolved']) {
    const row = key === 'confirmed' ? collision() : uncertain();
    assert.equal(parse(payload({ [key]: Array.from({ length: 50 }, () => row) }))[key].length, 50);
    assert.equal(parse(payload({ [key]: Array.from({ length: 51 }, () => row) })), null);
  }
});

test('invalid totals cannot invent evidence or understate the displayed rows', () => {
  for (const invalidCount of [-1, 0, 1.5, '1', null, 1_000_001]) {
    assert.equal(parse(payload({ confirmed: [collision()], confirmedCount: invalidCount })), null,
      `invalid confirmedCount ${invalidCount}`);
    assert.equal(parse(payload({ unresolved: [uncertain()], unresolvedCount: invalidCount })), null,
      `invalid unresolvedCount ${invalidCount}`);
  }
  assert.equal(parse(payload()), null, 'empty evidence is not a diagnostic');
  assert.equal(parse(payload({ confirmedCount: 1 })), null, 'a total requires a representative confirmed row');
  assert.equal(parse(payload({ unresolvedCount: 1 })), null, 'a total requires a representative unresolved row');
  assert.equal(parse(payload({ confirmed: [collision()], confirmedCount: 1_000_000 })).confirmedCount, 1_000_000);
});

test('confirmed evidence requires a real date or weekday and a valid bounded overlap', () => {
  const invalidRows = [
    { date: '2026-02-30' }, { date: '2026-13-01' }, { date: '2026-10-29T00:00:00Z' },
    { date: null, weekday: -1 }, { date: null, weekday: 7 }, { date: null, weekday: '4' },
    { startMinute: '1050' }, { startMinute: null }, { startMinute: -1 }, { endMinute: 1441 },
    { startMinute: 1170 }, { overlapStartMinute: 1140 }, { overlapStartMinute: 1049 },
    { overlapEndMinute: 1171 }, { overlapEndMinute: 1050 },
    { teacherName: null, classroomName: null, sameClass: null },
    { className: '' }, { className: { name: '합성 수업' } },
  ];
  for (const row of invalidRows) {
    assert.equal(parse(payload({ confirmed: [collision(row)] })), null, JSON.stringify(row));
  }
  assert.equal(parse(payload({ confirmed: [collision({ endMinute: 1440, overlapEndMinute: 1440 })] })).confirmed[0].endMinute, 1440);
});

test('unresolved fields come from the public vocabulary and duplicate labels are collapsed', () => {
  assert.deepEqual(parse(payload({ unresolved: [uncertain({ missingFields: ['time', 'time', 'classroom'] })] })).unresolved[0].missingFields,
    ['time', 'classroom']);
  for (const missingFields of [[], null, 'time', ['secret'], ['__proto__'], ['constructor'], ['toString'], ['time', 1]]) {
    assert.equal(parse(payload({ unresolved: [uncertain({ missingFields })] })), null, JSON.stringify(missingFields));
  }
});

test('malformed, oversized, or future-version DETAIL falls back without exposing diagnostics', () => {
  const invalidDetails = [
    privateDiagnostic, '{not-json', JSON.stringify(null), JSON.stringify([]),
    JSON.stringify(payload({ version: 2, confirmed: [collision()], raw: privateDiagnostic })),
    JSON.stringify(payload({ confirmed: [null], raw: privateDiagnostic })),
    JSON.stringify(payload({ unresolved: [null], raw: privateDiagnostic })),
    JSON.stringify({ version: 1, confirmed: null, unresolved: [] }),
    `${' '.repeat(65_537)}${JSON.stringify(payload({ confirmed: [collision()] }))}`,
    payload({ confirmed: [collision()] }), null,
  ];
  for (const details of invalidDetails) {
    const error = failure(null, { details });
    assert.equal(parseTimetableOperationalConflictDetails(error), null);
    const message = timetableOperationalErrorMessage(error, fallback);
    assert.equal(message, '일정 확인을 통과하지 못해 저장하지 못했습니다. 입력은 유지되었습니다. 일정 정보를 확인해 주세요.');
    assertNoDiagnostic(message);
  }
});

test('only exact conflict SQLSTATE and message permit diagnostic display', () => {
  const valid = payload({ confirmed: [collision()] });
  for (const patch of [
    { code: '40001' }, { code: '23505' }, { code: '23p01' }, { code: null },
    { message: 'timetable_resource_conflict_other' }, { message: privateDiagnostic },
  ]) {
    const error = failure(valid, patch);
    assert.equal(parseTimetableOperationalConflictDetails(error), null);
    assert.equal(timetableOperationalErrorMessage(error, fallback), fallback);
    assertNoDiagnostic(timetableOperationalErrorMessage(error, fallback));
  }
  for (const error of [null, undefined, privateDiagnostic, {}, []]) {
    assert.equal(parseTimetableOperationalConflictDetails(error), null);
    assert.equal(timetableOperationalErrorMessage(error, fallback), fallback);
  }
});

test('technical cancellation and uncertain delivery never become a business collision', () => {
  const error = failure(payload({ confirmed: [collision()], unresolved: [uncertain()] }), {
    code: '57014', message: privateDiagnostic,
  });
  assert.equal(parseTimetableOperationalConflictDetails(error), null);
  assert.equal(timetableOperationalErrorMessage(error, fallback),
    '일정 확인에 시간이 오래 걸려 저장이 중단되었습니다. 잠시 후 다시 저장해 주세요.');
  assertNoDiagnostic(timetableOperationalErrorMessage(error, fallback));
  for (const name of ['TimeoutError', 'AbortError']) {
    const timeout = { code: '57000', name, message: privateDiagnostic, details: error.details };
    assert.equal(parseTimetableOperationalConflictDetails(timeout), null);
    assert.equal(timetableOperationalErrorMessage(timeout, fallback),
      '저장 결과를 확인하지 못했습니다. 입력은 유지되었으니 다시 저장해 주세요.');
    assertNoDiagnostic(timetableOperationalErrorMessage(timeout, fallback));
  }
});

test('display output whitelists plain labels and drops identifiers, secret fields, and raw data', () => {
  const detail = payload({
    confirmed: [collision({
      className: '  합성 A < B & C  ', teacherName: '  합성 담당  ', classroomName: '  합성 강의실  ',
      classId: 'class-id', sessionId: 'session-id', teacherId: 'teacher-id', classroomId: 'room-id',
      occupancyFingerprint: privateDiagnostic, secret: privateDiagnostic, rawPlan: { raw: privateDiagnostic },
    })],
    unresolved: [uncertain({
      className: '  합성 정보 누락 수업  ', classId: 'class-id', sessionId: 'session-id',
      reason: privateDiagnostic, raw: privateDiagnostic, teacherName: privateDiagnostic,
    })],
    secret: privateDiagnostic, sql: privateDiagnostic,
  });
  const saved = structuredClone(detail);
  const parsed = parse(detail);
  assert.deepEqual(parsed.confirmed[0], {
    className: '합성 A < B & C', date: '2026-10-29',
    startMinute: 1050, endMinute: 1170, overlapStartMinute: 1050, overlapEndMinute: 1140,
    teacherName: '합성 담당', classroomName: '합성 강의실',
  });
  assert.deepEqual(parsed.unresolved[0], {
    className: '합성 정보 누락 수업', date: '2026-10-29', missingFields: ['time', 'classroom'],
  });
  assertNoDiagnostic(parsed);
  assert.deepEqual(detail, saved, 'display parsing does not mutate the producer payload');
});

test('non-text and excessive labels cannot enter the display contract', () => {
  assert.equal(parse(payload({ confirmed: [collision({ className: 'x'.repeat(513) })] })), null);
  const detail = parse(payload({
    confirmed: [collision({ teacherName: { secret: privateDiagnostic }, classroomName: '합성 강의실' })],
    unresolved: [uncertain({ className: { secret: privateDiagnostic } }), uncertain({ className: 'x'.repeat(513) })],
  }));
  assert.equal(Object.hasOwn(detail.confirmed[0], 'teacherName'), false);
  assert.equal(Object.hasOwn(detail.unresolved[0], 'className'), false);
  assert.equal(Object.hasOwn(detail.unresolved[1], 'className'), false);
  assert.equal(parse(payload({ confirmed: [collision({ className: 'x'.repeat(512) })] })).confirmed[0].className.length, 512);
  assertNoDiagnostic(detail);
});
