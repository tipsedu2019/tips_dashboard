import test from 'node:test';
import assert from 'node:assert/strict';
import { authoredLegacyLessonDraft, applyAuthoredLegacyLessonEdit, patchAuthoredLegacyLesson,
  setAuthoredLegacyLessonFields, setAuthoredLegacyMakeupDate, authoredLegacyLessonValidationError } from '../src/features/operations/legacy-authored-lesson-plan.ts';

import { applyCalendarDateToggle } from '../src/lib/class-schedule-planner.js';
import { prepareLegacyLessonMonth } from '../src/features/operations/legacy-lesson-month.ts';

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

test('editing one fallback field preserves other fallbacks without materializing them; reset is explicit', () => {
  const saved = fixture();
  saved.sessionSchedules['2026-10-20'] = { startTime: '12:00', endTime: '13:00', classroomCatalogId: room };
  const displayed = saved.sessionSchedules['2026-10-20'];
  const next = setAuthoredLegacyLessonFields(saved, 'later', { ...displayed, endTime: '13:30' }, displayed);
  const result = applyAuthoredLegacyLessonEdit(next, saved);
  assert.equal(result.sessions[0].endTime, '13:30');
  assert.deepEqual(result.sessions[0], { ...saved.sessions[0], endTime: '13:30' });
  assert.deepEqual(result.sessions.slice(1), saved.sessions.slice(1));
  assert.deepEqual(result.sessionSchedules['2026-10-20'], { startTime: '12:00', classroomCatalogId: room });
  const reset = setAuthoredLegacyLessonFields(result, 'later', {}, {}, true);
  assert.deepEqual(reset.sessions[0], saved.sessions[0]);
  assert.equal(Object.hasOwn(reset.sessionSchedules, '2026-10-20'), false);
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
  assert.equal(cleared.sessions[0].state, 'active');
  assert.equal(cleared.sessions[0].scheduleState, 'active');
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

// Independent review fixtures retained with unchanged assertions.
const independentReviewOriginal = () => ({selectedDays:[1],billingPeriods:[{id:'oct',month:10,label:'10월',startDate:'2026-10-01',endDate:'2026-10-31'}],
 sessions:[{id:'source',sessionKey:'source',date:'2026-10-05',billingId:'oct',memo:'  user memo  ',teacherNote:'user teacher note',textbookEntries:[{id:'learning-entry',content:'keep'}],startTime:'09:00',endTime:'10:00'}],sessionStates:{},sessionSchedules:{}});

test('independent: calendar restores original lesson after clearing linked makeup',()=>{
 const saved=setAuthoredLegacyMakeupDate(independentReviewOriginal(),'source','2026-10-06');
 const clicked=applyCalendarDateToggle(saved,'2026-10-05',{hasSession:true,hasBaseSession:true,isMakeup:false});
 const result=applyAuthoredLegacyLessonEdit(clicked,saved);
 assert.equal(result.sessions.length,1,'linked makeup removed');
 assert.equal(result.sessions[0].scheduleState,'active','calendar active intent must not be rewritten to cancelled');
 assert.equal(result.sessions[0].state,'active');
});

test('independent: editing a time must not import date-map identity, content, billing or memo',()=>{
 const saved=independentReviewOriginal();
 saved.sessionSchedules['2026-10-05']={startTime:'11:00',endTime:'12:00',id:'opaque-map-id',billingId:'other-billing',memo:'map-only memo',teacherNote:'map-only teacher note',textbookEntries:[{id:'map-only-entry'}]};
 const displayed={startTime:'11:00',endTime:'12:00',teacherCatalogId:'',classroomCatalogId:''};
 const result=setAuthoredLegacyLessonFields(saved,'source',{...displayed,endTime:'12:30'},displayed);
 for(const key of ['id','billingId','memo','teacherNote','textbookEntries'])assert.deepEqual(result.sessions[0][key],saved.sessions[0][key],`unrelated ${key} remains authored`);
 assert.equal(result.sessions[0].endTime,'12:30');
});

test('independent policy boundary: month creation without weekly days remains blocked',()=>{
 const result=prepareLegacyLessonMonth({selectedDays:[],billingPeriods:[],sessions:[]},'2026-10','oct');
 assert.equal(result.period,null);
 assert.equal(result.error,'수업 요일을 먼저 설정해 주세요.');
});


test('independent: date-map migration cannot silently change another displayed time',()=>{
 const saved=independentReviewOriginal();
 saved.sessionSchedules['2026-10-05']={startTime:'11:00',endTime:'12:00'};
 // Candidate workspace explicitly overlays raw row values over the effective
 // projection, so these are the field values shown to the operator.
 const displayed={startTime:'09:00',endTime:'10:00',teacherCatalogId:'',classroomCatalogId:''};
 const result=setAuthoredLegacyLessonFields(saved,'source',{...displayed,endTime:'13:00'},displayed);
 assert.equal(result.sessions[0].endTime,'13:00');
 assert.equal(result.sessions[0].startTime,'09:00','unchanged displayed start must not switch to hidden date-map time');
});

test('partial detail input and a no-op never import hidden map fields or erase omitted fields', () => {
  const saved = independentReviewOriginal();
  saved.sessions[0].teacherCatalogId = teacher;
  saved.sessionSchedules['2026-10-05'] = { startTime: '11:00', endTime: '12:00', memo: 'map memo', opaque: { retained: true } };
  assert.equal(setAuthoredLegacyLessonFields(saved, 'source', { endTime: '10:00' }, saved.sessions[0]), saved);
  const next = setAuthoredLegacyLessonFields(saved, 'source', { endTime: '13:00' }, saved.sessions[0]);
  assert.deepEqual(next.sessions[0], { ...saved.sessions[0], endTime: '13:00' });
  assert.deepEqual(next.sessionSchedules['2026-10-05'], { memo: 'map memo', opaque: { retained: true } });
  assert.deepEqual(saved.sessions[0].startTime, '09:00');
});

test('calendar map edit applies only changed schedule fields and preserves row and map metadata', () => {
  const saved = independentReviewOriginal();
  saved.sessionSchedules['2026-10-05'] = { startTime: '11:00', endTime: '12:00', id: 'not-a-lesson', billingId: 'not-a-period', memo: 'map memo' };
  const next = { ...saved, sessionSchedules: { '2026-10-05': { ...saved.sessionSchedules['2026-10-05'], endTime: '13:00', memo: 'changed map memo' } } };
  const result = applyAuthoredLegacyLessonEdit(next, saved);
  assert.deepEqual(result.sessions[0], { ...saved.sessions[0], endTime: '13:00' });
  assert.deepEqual(result.sessionSchedules['2026-10-05'], { id: 'not-a-lesson', billingId: 'not-a-period', memo: 'changed map memo' });
  const metadataOnly = applyAuthoredLegacyLessonEdit({ ...saved, sessionSchedules: { '2026-10-05': { ...saved.sessionSchedules['2026-10-05'], memo: 'changed map memo' } } }, saved);
  assert.deepEqual(metadataOnly.sessions, saved.sessions);
});

test('explicit reset clears only schedule overrides and retains opaque map metadata', () => {
  const saved = independentReviewOriginal();
  saved.sessionSchedules['2026-10-05'] = { startTime: '11:00', classroomCatalogId: room, memo: 'map memo', opaque: null };
  const result = setAuthoredLegacyLessonFields(saved, 'source', {}, {}, true);
  const expected = { ...saved.sessions[0] }; delete expected.startTime; delete expected.endTime;
  assert.deepEqual(result.sessions[0], expected);
  assert.deepEqual(result.sessionSchedules['2026-10-05'], { memo: 'map memo', opaque: null });
});

test('new makeup row accepts schedule fallback fields without importing another identity or learning content', () => {
  const saved = independentReviewOriginal();
  saved.sessionSchedules['2026-10-06'] = { startTime: '14:00', endTime: '15:00', classroomCatalogId: room,
    id: 'map-id', sessionKey: 'map-key', billingId: 'map-billing', memo: 'map memo', teacherNote: 'map note', textbookEntries: ['map learning'], state: 'active' };
  const result = setAuthoredLegacyMakeupDate(saved, 'source', '2026-10-06', 'chosen memo');
  const makeup = result.sessions[1];
  assert.notEqual(makeup.id, 'map-id'); assert.equal(makeup.id, makeup.sessionKey);
  assert.equal(makeup.billingId, 'oct'); assert.equal(makeup.memo, 'chosen memo');
  assert.equal(makeup.state, 'makeup'); assert.equal(makeup.startTime, '14:00');
  assert.equal(makeup.classroomCatalogId, room);
  assert.equal(Object.hasOwn(makeup, 'teacherNote'), false); assert.equal(Object.hasOwn(makeup, 'textbookEntries'), false);
  assert.deepEqual(result.sessionSchedules, saved.sessionSchedules);
});
