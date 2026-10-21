import test from 'node:test';
import assert from 'node:assert/strict';
import { authoredLegacyLessonDraft, applyAuthoredLegacyLessonEdit, patchAuthoredLegacyLesson,
  setAuthoredLegacyLessonFields, setAuthoredLegacyMakeupDate, authoredLegacyLessonValidationError } from '../src/features/operations/legacy-authored-lesson-plan.ts';

const teacher = 'ab000000-0000-4000-8000-000000000101', room = 'ab000000-0000-4000-8000-000000000201';
const catalogs = { teachers: [{ id: teacher, name: 'Synthetic teacher' }], rooms: [{ id: room, name: 'Synthetic room' }] };
const fixture = () => ({ selectedDays: [2, 4], billingPeriods: [{ id: 'oct', month: 10, label: '10월', startDate: '2026-10-01', endDate: '2026-10-29' }],
  sessions: [
    { id: 'later', date: '2026-10-20', billingId: 'oct', sessionNumber: 17, memo: '  authored\n memo  ', teacherNote: '  history ', opaqueHistory: { untouched: true } },
    { id: 'off-weekday', date: '2026-10-09', billingId: 'oct', startTime: '14:20', endTime: '15:40', teacherCatalogId: teacher, classroomCatalogId: room, memo: '', textbookEntries: [{ arbitrary: 'history' }] },
    { id: 'same-date-peer', date: '2026-10-09', billingId: 'oct', startTime: '16:00', endTime: '17:00', classroomCatalogId: null },
  ], history: [{ opaque: 'history must not be canonicalized' }], sessionStates: {}, sessionSchedules: {} });

test('opening a sparse/off-weekday materialized plan never generates, sorts or canonicalizes its rows', () => {
  const saved = fixture(), draft = authoredLegacyLessonDraft(saved);
  assert.deepEqual(draft, saved);
  assert.deepEqual(applyAuthoredLegacyLessonEdit(draft, draft), saved);
  assert.equal(draft.sessions, saved.sessions);
  assert.deepEqual(authoredLegacyLessonDraft({ ...saved, sessions: [] }).sessions, []);
});

test('a single ID edit leaves same-period and same-date peers byte-for-byte intact and preserves memo whitespace', () => {
  const saved = fixture(), first = authoredLegacyLessonDraft(saved);
  const updated = patchAuthoredLegacyLesson(first, 'off-weekday', { memo: '  new\n memo  ' });
  const edited = applyAuthoredLegacyLessonEdit(updated, first);
  assert.deepEqual(edited.sessions.map(row => row.id), saved.sessions.map(row => row.id));
  assert.deepEqual(edited.sessions[0], saved.sessions[0]);
  assert.deepEqual(edited.sessions[2], saved.sessions[2]);
  assert.deepEqual(edited.sessions[1], { ...saved.sessions[1], memo: '  new\n memo  ' });
  assert.equal(patchAuthoredLegacyLesson(edited, 'off-weekday', { memo: '' }).sessions[1].memo, '');
  assert.deepEqual(edited.billingPeriods, saved.billingPeriods);
  assert.deepEqual(edited.history, saved.history);
});

test('calendar state intents preserve the stored memo rather than copying the generator empty memo', () => {
  const saved = fixture();
  const next = { ...saved, sessionStates: { '2026-10-20': { state: 'exception', memo: '' } } };
  const result = applyAuthoredLegacyLessonEdit(next, saved);
  assert.deepEqual(result.sessions, [{ ...saved.sessions[0], state: 'exception', scheduleState: 'exception' }, ...saved.sessions.slice(1)]);
});

test('explicit period expansion appends only newly requested dates while preserving all saved rows in order', () => {
  const original = fixture();
  original.billingPeriods[0].startDate = '2026-10-06';
  original.billingPeriods[0].endDate = '2026-10-27';
  const next = { ...original, billingPeriods: [{ ...original.billingPeriods[0], startDate: '2026-10-01', endDate: '2026-10-29' }] };
  const result = applyAuthoredLegacyLessonEdit(next, original);
  assert.deepEqual(result.sessions.slice(0, 3), original.sessions);
  assert.deepEqual(result.sessions.slice(3).map(row => row.date), ['2026-10-01','2026-10-29'], 'range expansion does not refill deliberately absent dates in the old range');
  assert.deepEqual(result.history, original.history);
});

test('row fields are explicit, date-sharing peers and old ambiguous date maps remain untouched', () => {
  const saved = fixture();
  saved.sessionSchedules['2026-10-09'] = { classroomCatalogId: null };
  const current = saved.sessions[1];
  const next = setAuthoredLegacyLessonFields(saved, current.id, { ...current, endTime: '16:20' }, current);
  const result = applyAuthoredLegacyLessonEdit(next, saved);
  assert.deepEqual(result.sessions[1], { ...current, endTime: '16:20' });
  assert.deepEqual(result.sessions[2], saved.sessions[2]);
  assert.deepEqual(result.sessionSchedules, saved.sessionSchedules);
  assert.equal(authoredLegacyLessonValidationError(result, saved, catalogs), '');
});

test('a single date-map edit migrates only its selected row; reset is explicit and preserves peers', () => {
  const saved = fixture();
  saved.sessionSchedules['2026-10-20'] = { startTime: '12:00', endTime: '13:00', classroomCatalogId: room };
  const displayed = saved.sessionSchedules['2026-10-20'];
  const next = setAuthoredLegacyLessonFields(saved, 'later', { ...displayed, endTime: '13:30' }, displayed);
  const result = applyAuthoredLegacyLessonEdit(next, saved);
  assert.equal(result.sessions[0].endTime, '13:30');
  assert.equal(result.sessions[0].classroomCatalogId, room);
  assert.deepEqual(result.sessions.slice(1), saved.sessions.slice(1));
  assert.equal(Object.hasOwn(result.sessionSchedules, '2026-10-20'), false);
  assert.deepEqual(setAuthoredLegacyLessonFields(result, 'later', {}, {}, true).sessions[0], saved.sessions[0]);
});

test('missing historical/inherited details and overlapping explicit rows are allowed, invalid authored values are not', () => {
  const saved = fixture();
  const newRow = { id: 'new', date: '2020-10-09', state: 'active' };
  const write = row => authoredLegacyLessonValidationError({ ...saved, sessions: [...saved.sessions, row] }, saved, catalogs);
  assert.equal(write(newRow), '');
  assert.equal(write({ ...newRow, date: '2026-10-09', startTime: '14:20', endTime: '15:40', teacherCatalogId: teacher, classroomCatalogId: room }), '');
  assert.equal(write({ ...newRow, startTime: null, teacherCatalogId: '', classroomCatalogId: null }), '');
  for (const patch of [{ date: '2026-02-30' }, { id: 'later' }, { id: {} }, { startTime: {} }, { startTime: '09:80' },
    { startTime: '15:00', endTime: '14:00' }, { teacherCatalogId: room }, { classroomCatalogId: 'bad-id' }, { memo: [] }, { classroomName: 'unknown room' }]) {
    assert.notEqual(write({ ...newRow, ...patch }), '', JSON.stringify(patch));
  }
});

test('unchanged malformed history keeps its exact multiplicity; a memo edit does not require an old missing date', () => {
  const history = [{ memo: 'idless history' }, null, 'old malformed row', { id: 'partial', memo: 'old', startTime: 'bad historical time' }];
  const saved = { sessions: history, sessionSchedules: null, sessionStates: null, selectedDays: [], billingPeriods: [] };
  const next = { ...saved, sessions: [...history, { id: 'new', date: '2026-10-01' }] };
  assert.equal(authoredLegacyLessonValidationError(next, saved, catalogs), '');
  assert.deepEqual(authoredLegacyLessonDraft(saved), saved, 'empty-map defaults must not replace original null metadata');
  const appended = applyAuthoredLegacyLessonEdit({ ...saved, selectedDays: [2, 4], billingPeriods: [
    { id: 'oct', month: 10, label: '10월', startDate: '2026-10-01', endDate: '2026-10-29' },
  ] }, saved);
  assert.deepEqual(appended.sessions.slice(0, history.length), history);
  assert.equal(appended.sessions.length, history.length + 9);
  assert.equal(authoredLegacyLessonValidationError(appended, saved, catalogs), '');
  assert.equal(authoredLegacyLessonValidationError({ ...next, sessions: next.sessions.map(row => row?.id === 'partial' ? { ...row, memo: ' changed ' } : row) }, saved, catalogs), '');
  assert.notEqual(authoredLegacyLessonValidationError({ ...next, sessions: [...next.sessions, history[0]] }, saved, catalogs), '', 'new malformed duplicates cannot borrow an old exemption');
  assert.notEqual(authoredLegacyLessonValidationError({ ...next, sessions: [...next.sessions, { id: 'new', date: '2026-10-01' }] }, saved, catalogs), '');
});

test('catalog references accept canonical PostgreSQL UUID shapes while still requiring an existing catalog entry', () => {
  const v7 = 'ab000000-0000-7000-8000-000000000101', nil = '00000000-0000-0000-0000-000000000000';
  const saved = fixture(), row = { id: 'new-reference', date: '2026-10-01', teacherCatalogId: v7, classroomCatalogId: nil };
  const available = { teachers: [{ id: v7 }], rooms: [{ id: nil }] };
  const write = (patch = {}, refs = available) => authoredLegacyLessonValidationError({ ...saved, sessions: [...saved.sessions, { ...row, ...patch }] }, saved, refs);
  assert.equal(write(), '', 'UUID version and variant are not an additional catalog restriction');
  assert.notEqual(write({}, { ...available, rooms: [] }), '', 'a canonical UUID still requires a real catalog');
  assert.notEqual(write({ teacherCatalogId: 'not-a-uuid' }, { ...available, teachers: [{ id: 'not-a-uuid' }] }), '', 'catalog lookup does not replace UUID syntax validation');
});

test('calendar substitution creates one separate intended ID even when the destination already has a lesson', () => {
  const saved = fixture();
  const next = setAuthoredLegacyMakeupDate(saved, 'later', '2026-10-09');
  assert.equal(next.sessions.length, 4);
  assert.deepEqual(next.sessions.slice(1, 3), saved.sessions.slice(1));
  assert.equal(next.sessions[3].date, '2026-10-09');
  assert.notEqual(next.sessions[3].id, saved.sessions[1].id);
  assert.deepEqual(setAuthoredLegacyMakeupDate(next, 'later', '2026-10-09'), next, 'same substitution is idempotent');
  const cleared = setAuthoredLegacyMakeupDate(next, 'later', '');
  assert.equal(cleared.sessions.length, 3);
  assert.deepEqual(cleared.sessions.slice(1), saved.sessions.slice(1));
});

test('approved makeup rows remain opaque through ordinary editing and period generation', () => {
  const saved = fixture(), request = 'ab000000-0000-4000-8000-000000000900';
  const id = `makeup-request:${request}:0`;
  saved.sessions.push({ id, sessionKey: id, makeupRequestId: request, makeupRequestRole: 'makeup', date: '2026-10-09', memo: ' approved\nraw ', startTime: '22:00', endTime: '23:00' });
  assert.deepEqual(patchAuthoredLegacyLesson(saved, id, { memo: 'invalid edit' }), saved);
  const result = applyAuthoredLegacyLessonEdit({ ...saved, billingPeriods: [...saved.billingPeriods,
    { id: 'nov', month: 11, label: '11월', startDate: '2026-11-03', endDate: '2026-11-26' }] }, saved);
  assert.deepEqual(result.sessions.slice(0, saved.sessions.length), saved.sessions);
  assert.equal(result.sessions.length, saved.sessions.length + 8);
});
