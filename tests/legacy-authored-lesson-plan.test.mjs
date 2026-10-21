import test from 'node:test';
import assert from 'node:assert/strict';
import { authoredLegacyLessonDraft, applyAuthoredLegacyLessonEdit, patchAuthoredLegacyLesson,
  setAuthoredLegacyLessonFields, setAuthoredLegacyMakeupDate, authoredLegacyLessonValidationError } from '../src/features/operations/legacy-authored-lesson-plan.ts';

import { applyCalendarDateToggle } from '../src/lib/class-schedule-planner.js';
import { effectiveInputForLesson, resolveEffectiveSchedule } from '../src/features/operations/legacy-effective-schedule.js';
import { prepareLegacyLessonMonth } from '../src/features/operations/legacy-lesson-month.ts';
import { buildClassScheduleRouteModel } from '../src/features/operations/records.js';

const teacher = 'ab000000-0000-4000-8000-000000000101', room = 'ab000000-0000-4000-8000-000000000201';
const catalogs = { teachers: [{ id: teacher, name: 'Synthetic teacher' }], rooms: [{ id: room, name: 'Synthetic room' }] };
const fixture = () => ({ selectedDays: [2, 4], billingPeriods: [{ id: 'oct', month: 10, label: '10월', startDate: '2026-10-01', endDate: '2026-10-29' }],
  sessions: [
    { id: 'later', date: '2026-10-20', billingId: 'oct', sessionNumber: 17, memo: '  authored\n memo  ', teacherNote: '  history ', opaqueHistory: { untouched: true } },
    { id: 'off-weekday', date: '2026-10-09', billingId: 'oct', startTime: '14:20', endTime: '15:40', teacherCatalogId: teacher, classroomCatalogId: room, memo: '', textbookEntries: [{ arbitrary: 'history' }] },
    { id: 'same-date-peer', date: '2026-10-09', billingId: 'oct', startTime: '16:00', endTime: '17:00', classroomCatalogId: null },
  ], history: [{ opaque: 'history must not be canonicalized' }], sessionStates: {}, sessionSchedules: {} });

for (const direction of ['before', 'after', 'both']) {
  test(`PR161: ${direction} expansion preserves original rows and never borrows numbered progress`, () => {
    const saved = fixture();
    saved.billingPeriods[0] = { ...saved.billingPeriods[0], startDate: '2026-10-06', endDate: '2026-10-27' };
    saved.sessions = [{ ...saved.sessions[0], id: 'numbered-original', date: '2026-10-06', sessionNumber: 1 }];
    const period = { ...saved.billingPeriods[0],
      startDate: direction === 'after' ? '2026-10-06' : '2026-10-01',
      endDate: direction === 'before' ? '2026-10-27' : '2026-10-29' };
    const result = applyAuthoredLegacyLessonEdit({ ...saved, billingPeriods: [period] }, saved);
    assert.deepEqual(result.sessions[0], saved.sessions[0]);
    const added = result.sessions.slice(1);
    assert.equal(added.length, direction === 'both' ? 2 : 1);
    assert.ok(added.every(row => row.sessionNumber === null), 'new rows must not reuse isolated planner ordinals');
    assert.equal(new Set(result.sessions.map(row => row.id)).size, result.sessions.length);
    for (const oldId of ['', 'numbered-original']) {
      const progressLogs = [{ class_id: 'synthetic-class', session_id: oldId, session_order: 1,
        status: 'done', content: 'original learning', teacher_note: 'original note', updated_at: '2026-10-06' }];
      const read = (logs) => buildClassScheduleRouteModel({ classes: [{ id: 'synthetic-class', name: 'Synthetic', schedulePlan: result }], progressLogs: logs }).rows[0].raw.sessions;
      const viewed = read(progressLogs);
      assert.equal(viewed.find(row => row.id === 'numbered-original').content, 'original learning');
      for (const row of added) {
        const fresh = viewed.find(item => item.id === row.id);
        assert.equal(fresh.progressStatus, 'pending'); assert.equal(fresh.content, ''); assert.equal(fresh.teacherNote, '');
      }
      const exact = read([...progressLogs, { class_id: 'synthetic-class', session_id: added[0].id,
        status: 'done', content: 'new exact-ID learning', updated_at: '2026-10-30' }]);
      assert.equal(exact.find(row => row.id === added[0].id).content, 'new exact-ID learning');
    }
    assert.deepEqual(applyAuthoredLegacyLessonEdit(result, result), result, 'read/save does not renumber accepted rows');
  });
}

test('PR161: authored time validation matches resolver start and end boundaries', () => {
  const saved = { sessions: [] };
  for (const [startTime, endTime, valid] of [
    ['24:00', undefined, false], ['24:00', null, false], ['24:00', '', false],
    ['23:00', '24:00', true], ['23:00:00', '24:00:00.000', true],
    ['9:00', '10:00', true], ['23:59', undefined, true],
    ['23:00', '24:01', false], ['23:00:01', '24:00', false], ['23:00', '24:00:00.1', false],
  ]) {
    const row = { id: 'time-edge', date: '2026-10-01', startTime, ...(endTime !== undefined ? { endTime } : {}) };
    assert.equal(authoredLegacyLessonValidationError({ sessions: [row] }, saved) === '', valid, JSON.stringify(row));
    if (valid && endTime) {
      const resolved = resolveEffectiveSchedule({ session: row, basicSlots: [], catalogs: {} });
      assert.equal(resolved.values.startTime, startTime.slice(0, 5).padStart(5, '0'));
      assert.equal(resolved.values.endTime, endTime.slice(0, 5));
    }
  }
});

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
  assert.deepEqual(result.sessionSchedules['2026-10-20'], { startTime: '12:00', endTime: '13:30', classroomCatalogId: room });
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
  assert.equal(cleared.sessions[0].state, 'exception', 'unlink preserves source cancellation; normal restoration is a separate action');
  assert.equal(cleared.sessions[0].scheduleState, 'exception');
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
  assert.deepEqual(next.sessionSchedules['2026-10-05'], { startTime: '09:00', endTime: '13:00', teacherCatalogId: teacher, memo: 'map memo', opaque: { retained: true } });
  assert.deepEqual(saved.sessions[0].startTime, '09:00');
});

test('calendar map edit applies only changed schedule fields and preserves row and map metadata', () => {
  const saved = independentReviewOriginal();
  saved.sessionSchedules['2026-10-05'] = { startTime: '11:00', endTime: '12:00', id: 'not-a-lesson', billingId: 'not-a-period', memo: 'map memo' };
  const next = { ...saved, sessionSchedules: { '2026-10-05': { ...saved.sessionSchedules['2026-10-05'], endTime: '13:00', memo: 'changed map memo' } } };
  const result = applyAuthoredLegacyLessonEdit(next, saved);
  assert.deepEqual(result.sessions[0], { ...saved.sessions[0], endTime: '13:00' });
  assert.deepEqual(result.sessionSchedules['2026-10-05'], { startTime: '09:00', endTime: '13:00', id: 'not-a-lesson', billingId: 'not-a-period', memo: 'changed map memo' });
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

// Second independent review: unchanged consumer assertions for initial reproduction.
const adjacentFixture=()=>({selectedDays:[1],billingPeriods:[{id:'oct',month:10,label:'10월',startDate:'2026-10-01',endDate:'2026-10-31'}],
 sessions:[{id:'source',sessionKey:'source',date:'2026-10-05',billingId:'oct',memo:'  user memo  ',teacherNote:'user teacher note',textbookEntries:[{id:'learning-entry',content:'keep'}]}],sessionStates:{},sessionSchedules:{}});
const adjacentContext={version:1,basicSlots:[{id:'basic',weekday:1,startTime:'09:00',endTime:'10:00',teacherCatalogId:teacher,classroomCatalogId:room}],catalogs:{teachers:[{id:teacher,name:'teacher'}],rooms:[{id:room,name:'room'}]}};
const resolved=plan=>resolveEffectiveSchedule(effectiveInputForLesson(plan,plan.sessions[0],adjacentContext));

test('adjacent: first calendar cancellation must survive absent-to-empty makeup normalization',()=>{
 const saved=adjacentFixture();
 const clicked=applyCalendarDateToggle(saved,'2026-10-05',{hasSession:true,hasBaseSession:true,isMakeup:false});
 assert.equal(clicked.sessionStates['2026-10-05'].state,'exception','the actual planner expresses cancellation');
 assert.equal(clicked.sessionStates['2026-10-05'].makeupDate,'','planner normalizes absent makeup date to empty');
 const result=applyAuthoredLegacyLessonEdit(clicked,saved);
 assert.equal(result.sessions[0].scheduleState,'exception','one normal calendar click must cancel');
 assert.equal(result.sessions[0].state,'exception');
 assert.equal(result.sessionStates['2026-10-05'].state,'exception');
 assert.equal(result.sessions[0].memo,saved.sessions[0].memo);
});

test('adjacent: partial date-map migration must remain visible to the existing effective reader',()=>{
 const saved=adjacentFixture();saved.sessionSchedules['2026-10-05']={startTime:'12:00',endTime:'13:00',classroomCatalogId:room};
 const displayed=resolved(saved).values;
 assert.equal(displayed.endTime,'13:00');
 const updated=setAuthoredLegacyLessonFields(saved,'source',{...displayed,endTime:'13:30'},displayed);
 const result=applyAuthoredLegacyLessonEdit(updated,saved);
 assert.equal(result.sessions[0].endTime,'13:30','raw authored edit is present');
 assert.equal(resolved(result).values.endTime,'13:30','existing reader must use the saved edit instead of basic 10:00');
 assert.equal(resolved(result).kind,'resolved');
});

test('adjacent: retaining opaque date-map metadata must not hide raw schedule fields',()=>{
 const saved=adjacentFixture();Object.assign(saved.sessions[0],{startTime:'14:00',endTime:'15:00',teacherCatalogId:teacher,classroomCatalogId:null});
 saved.sessionSchedules['2026-10-05']={startTime:'12:00',endTime:'13:00',opaque:{retained:true}};
 const updated=setAuthoredLegacyLessonFields(saved,'source',{endTime:'15:30'},saved.sessions[0]);
 // The existing reader treats any object as the complete override. Keep opaque
 // metadata and assert the exact synchronized schedule instead of a broken
 // metadata-only representation; all effective-value assertions stay intact.
 assert.deepEqual(updated.sessionSchedules['2026-10-05'],{startTime:'14:00',endTime:'15:30',teacherCatalogId:teacher,classroomCatalogId:null,opaque:{retained:true}});
 assert.equal(updated.sessions[0].endTime,'15:30');
 assert.equal(resolved(updated).values.endTime,'15:30','metadata-only map must not suppress raw saved fields');
 assert.equal(resolved(updated).values.classroomCatalogId,null,'explicit unassigned room must remain unassigned');
});

test('adjacent control: cancellation with already-empty makeup metadata remains cancelled',()=>{
 const saved=adjacentFixture();saved.sessionStates['2026-10-05']={state:'active',makeupDate:''};
 const clicked=applyCalendarDateToggle(saved,'2026-10-05',{hasSession:true,hasBaseSession:true,isMakeup:false});
 const result=applyAuthoredLegacyLessonEdit(clicked,saved);
 assert.equal(result.sessions[0].scheduleState,'exception');assert.equal(result.sessions[0].memo,saved.sessions[0].memo);
});

test('adjacent control: unlinking a real makeup preserves cancellation without touching approved peer',()=>{
 const saved=adjacentFixture(),request='ab000000-0000-4000-8000-000000000900',id=`makeup-request:${request}:0`;
 const approved={id,sessionKey:id,makeupRequestId:request,makeupRequestRole:'makeup',date:'2026-10-06',memo:'approved',teacherNote:'preserve',textbookEntries:[{id:'approved-learning'}]};
 saved.sessions.push(approved);
 const added=setAuthoredLegacyMakeupDate(saved,'source','2026-10-06');
 const restored=setAuthoredLegacyMakeupDate(added,'source','');
 assert.equal(restored.sessions.length,2);assert.equal(restored.sessions[0].scheduleState,'exception');assert.deepEqual(restored.sessions[1],approved);
});

test('reader parity fixtures preserve authored fields through the existing consumer contract', t => {
  const check = (name, plan, row, expected) => {
    const input = JSON.parse(JSON.stringify(effectiveInputForLesson(plan, row, adjacentContext)));
    const result = resolveEffectiveSchedule(input);
    for (const [field, value] of Object.entries(expected)) {
      assert.deepEqual(field === 'kind' ? result.kind : result.values[field], value, `${name}: ${field}`);
    }
    t.diagnostic(JSON.stringify({ lessonReaderCase: name, input, expected: result }));
  };
  const partial = adjacentFixture();
  partial.sessionSchedules['2026-10-05'] = { startTime: '12:00', endTime: '13:00', classroomCatalogId: room };
  const edited = setAuthoredLegacyLessonFields(partial, 'source', { endTime: '13:30' }, resolved(partial).values);
  assert.deepEqual(edited.sessions[0], { ...partial.sessions[0], endTime: '13:30' });
  check('partial-map', edited, edited.sessions[0], { startTime: '12:00', endTime: '13:30', kind: 'resolved' });

  const metadata = adjacentFixture();
  Object.assign(metadata.sessions[0], { startTime: '14:00', endTime: '15:00', teacherCatalogId: teacher, classroomCatalogId: null });
  metadata.sessionSchedules['2026-10-05'] = { opaque: { retained: true } };
  const metadataEdited = setAuthoredLegacyLessonFields(metadata, 'source', { endTime: '15:30' }, metadata.sessions[0]);
  assert.deepEqual(metadataEdited.sessionSchedules['2026-10-05'].opaque, metadata.sessionSchedules['2026-10-05'].opaque);
  check('metadata-map-null-room', metadataEdited, metadataEdited.sessions[0], { startTime: '14:00', endTime: '15:30', classroomCatalogId: null, kind: 'resolved' });

  const explicit = independentReviewOriginal();
  explicit.sessionSchedules['2026-10-05'] = { startTime: '11:00', endTime: '12:00', memo: 'unrelated map memo' };
  const explicitEdited = setAuthoredLegacyLessonFields(explicit, 'source', { endTime: '13:00' }, explicit.sessions[0]);
  check('raw-start-survives-map', explicitEdited, explicitEdited.sessions[0], { startTime: '09:00', endTime: '13:00', kind: 'resolved' });
  assert.equal(explicitEdited.sessions[0].memo, explicit.sessions[0].memo);

  const clearRoom = adjacentFixture();
  clearRoom.sessionSchedules['2026-10-05'] = { startTime: '12:00', endTime: '13:00', classroomCatalogId: room, classroomName: 'room', classroomUnresolved: true };
  clearRoom.sessions[0].classroomUnresolved = true;
  const roomEdited = setAuthoredLegacyLessonFields(clearRoom, 'source', { classroomCatalogId: null }, { classroomCatalogId: room });
  assert.equal(Object.hasOwn(roomEdited.sessionSchedules['2026-10-05'], 'classroomName'), false);
  assert.equal(Object.hasOwn(roomEdited.sessionSchedules['2026-10-05'], 'classroomUnresolved'), false);
  assert.equal(Object.hasOwn(roomEdited.sessions[0], 'classroomUnresolved'), false);
  check('explicit-null-clears-room-name', roomEdited, roomEdited.sessions[0], { startTime: '12:00', endTime: '13:00', classroomCatalogId: null, kind: 'resolved' });

  const reset = setAuthoredLegacyLessonFields(metadataEdited, 'source', {}, {}, true);
  assert.deepEqual(reset.sessionSchedules['2026-10-05'], { opaque: { retained: true } });
  check('reset-to-basics', reset, reset.sessions[0], { startTime: '09:00', endTime: '10:00', classroomCatalogId: room, kind: 'resolved' });

  const mapped = adjacentFixture();
  mapped.sessionSchedules['2026-10-05'] = { startTime: '12:00', endTime: '13:00', opaque: true };
  const mapEdited = applyAuthoredLegacyLessonEdit({ ...mapped, sessionSchedules: { '2026-10-05': { ...mapped.sessionSchedules['2026-10-05'], endTime: '13:30' } } }, mapped);
  check('calendar-map-edit', mapEdited, mapEdited.sessions[0], { startTime: '12:00', endTime: '13:30', kind: 'resolved' });

  const sameDate = adjacentFixture(), request = 'ab000000-0000-4000-8000-000000000900';
  Object.assign(sameDate.sessions[0], { startTime: '14:00', endTime: '15:00' });
  const peer = { ...sameDate.sessions[0], id: 'peer', sessionKey: 'peer', startTime: '16:00', endTime: '17:00' };
  const approvedId = `makeup-request:${request}:0`;
  const approved = { ...peer, id: approvedId, sessionKey: approvedId, makeupRequestId: request, makeupRequestRole: 'makeup', startTime: '18:00', endTime: '19:00' };
  sameDate.sessions.push(peer, approved);
  const sameDateEdited = setAuthoredLegacyLessonFields(sameDate, 'source', { endTime: '15:30' }, sameDate.sessions[0]);
  assert.deepEqual(sameDateEdited.sessions.slice(1), sameDate.sessions.slice(1));
  assert.deepEqual(sameDateEdited.sessionSchedules, sameDate.sessionSchedules);
  check('same-date-selected', sameDateEdited, sameDateEdited.sessions[0], { startTime: '14:00', endTime: '15:30', kind: 'resolved' });
  check('same-date-peer-preserved', sameDateEdited, sameDateEdited.sessions[1], { startTime: '16:00', endTime: '17:00', kind: 'resolved' });
  check('same-date-approved-preserved', sameDateEdited, sameDateEdited.sessions[2], { startTime: '18:00', endTime: '19:00', kind: 'resolved' });

  const cancelled = applyAuthoredLegacyLessonEdit(applyCalendarDateToggle(adjacentFixture(), '2026-10-05', { hasSession: true, hasBaseSession: true }), adjacentFixture());
  check('first-cancellation', cancelled, cancelled.sessions[0], { kind: 'cancelled' });
  const linked = setAuthoredLegacyMakeupDate(adjacentFixture(), 'source', '2026-10-06');
  const restored = applyAuthoredLegacyLessonEdit(applyCalendarDateToggle(linked, '2026-10-05', { hasSession: true, hasBaseSession: true }), linked);
  assert.equal(restored.sessions.length, 1);
  check('linked-restoration', restored, restored.sessions[0], { startTime: '09:00', endTime: '10:00', kind: 'resolved' });
});

test('empty unlink is a no-op; an ID edit consumes shared date fallbacks without rewriting peers', () => {
  const saved = adjacentFixture();
  assert.equal(setAuthoredLegacyMakeupDate(saved, 'source', ''), saved);
  const cancelled = { ...saved, sessions: [{ ...saved.sessions[0], state: 'exception', scheduleState: 'exception' }] };
  assert.equal(setAuthoredLegacyMakeupDate(cancelled, 'source', ''), cancelled);
  const peer = { ...saved.sessions[0], id: 'peer', sessionKey: 'peer', endTime: '17:00' };
  saved.sessions.push(peer);
  saved.sessionSchedules['2026-10-05'] = { startTime: '12:00', endTime: '13:00', opaque: true };
  const edited = setAuthoredLegacyLessonFields(saved, 'source', { endTime: '15:30' }, { endTime: '13:00' });
  assert.deepEqual(edited.sessions[1], peer);
  assert.deepEqual(edited.sessionSchedules, saved.sessionSchedules);
  assert.equal(resolved(edited).values.endTime, '15:30');
  assert.equal(resolved(edited).values.startTime, '12:00');
  assert.equal(resolved(edited).kind, 'resolved');
});


test('calendar map intents cannot rewrite one ordinary row when an approved peer shares its date', () => {
  const saved = adjacentFixture(), request = 'ab000000-0000-4000-8000-000000000900';
  const id = `makeup-request:${request}:0`;
  saved.sessions.push({ id, sessionKey: id, makeupRequestId: request, makeupRequestRole: 'makeup', date: '2026-10-05', startTime: '16:00', endTime: '17:00' });
  saved.sessionSchedules['2026-10-05'] = { startTime: '12:00', endTime: '13:00' };
  const result = applyAuthoredLegacyLessonEdit({ ...saved, sessionSchedules: { '2026-10-05': { startTime: '12:00', endTime: '13:30' } } }, saved);
  assert.deepEqual(result.sessions, saved.sessions, 'date-addressed intent does not select an ordinary ID through an approved peer');
});

// One contract across UI scalar overrides, shared date fallbacks and legacy names.
// Independently stated expectations; SQL consumes these same emitted inputs.
for (const count of [1, 2]) for (const shape of ['raw-scalars', 'map-names', 'metadata-map', 'explicit-null']) {
  for (const editedField of ['startTime', 'endTime', 'teacherCatalogId', 'classroomCatalogId', 'memo']) {
    test(`field precedence: ${count} rows / ${shape} / ${editedField}`, t => {
      const teacherB = 'ab000000-0000-4000-8000-000000000102', roomB = 'ab000000-0000-4000-8000-000000000202';
      const context = { ...adjacentContext, catalogs: {
        teachers: [{ id: teacher, name: 'A teacher' }, { id: teacherB, name: 'B teacher' }],
        rooms: [{ id: room, name: 'A room' }, { id: roomB, name: 'B room' }],
      } };
      const plan = adjacentFixture(), row = plan.sessions[0];
      Object.assign(row, { memo: '  preserved\n memo  ', teacherNote: 'learning', textbookEntries: [{ id: 'book', progress: 'same' }] });
      plan.sessionSchedules['2026-10-05'] = { startTime: '12:00', endTime: '13:00', teacherName: 'B teacher', classroomName: 'B room', opaque: { keep: true }, memo: 'not row memo' };
      const expected = { startTime: '12:00', endTime: '13:00', teacherCatalogId: teacherB, classroomCatalogId: roomB };
      if (shape === 'raw-scalars') {
        Object.assign(row, { startTime: '14:00', endTime: '15:00', teacherCatalogId: teacher, classroomCatalogId: room });
        Object.assign(expected, { startTime: '14:00', endTime: '15:00', teacherCatalogId: teacher, classroomCatalogId: room });
      } else if (shape === 'map-names') {
        Object.assign(row, { teacherName: 'A teacher', classroomName: 'A room' });
      } else if (shape === 'metadata-map') {
        plan.sessionSchedules['2026-10-05'] = { opaque: { keep: true } };
        Object.assign(row, { teacherName: 'B teacher', classroomName: 'B room' });
        Object.assign(expected, { startTime: '09:00', endTime: '10:00', teacherCatalogId: teacher, classroomCatalogId: room });
      } else {
        Object.assign(row, { teacherCatalogId: '', classroomCatalogId: null });
        Object.assign(expected, { teacherCatalogId: null, classroomCatalogId: null });
      }
      if (count === 2) plan.sessions.push({ ...structuredClone(row), id: 'peer', sessionKey: 'peer', memo: 'peer memo' });
      const before = structuredClone(plan);
      const consume = (p, r) => resolveEffectiveSchedule(effectiveInputForLesson(p, r, context));
      assert.deepEqual(consume(plan, row).values, expected, 'unedited consumer contract');
      const changes = { startTime: '08:30', endTime: '17:30', teacherCatalogId: teacher, classroomCatalogId: room, memo: '  edited\n memo  ' };
      const value = editedField === 'teacherCatalogId' && expected.teacherCatalogId === teacher ? teacherB
        : editedField === 'classroomCatalogId' && expected.classroomCatalogId === room ? roomB : changes[editedField];
      const next = editedField === 'memo' ? patchAuthoredLegacyLesson(plan, 'source', { memo: value })
        : setAuthoredLegacyLessonFields(plan, 'source', { [editedField]: value }, expected);
      const result = consume(next, next.sessions[0]);
      assert.deepEqual(result.values, { ...expected, ...(editedField === 'memo' ? {} : { [editedField]: value }) });
      assert.equal(next.sessions[0].memo, editedField === 'memo' ? value : before.sessions[0].memo);
      for (const field of ['id', 'sessionKey', 'date', 'billingId', 'teacherNote', 'textbookEntries']) assert.deepEqual(next.sessions[0][field], before.sessions[0][field]);
      assert.deepEqual(next.sessions.slice(1), before.sessions.slice(1));
      if (count === 2) {
        assert.deepEqual(next.sessionSchedules, before.sessionSchedules);
        assert.deepEqual(consume(next, next.sessions[1]), consume(before, before.sessions[1]));
      }
      assert.deepEqual(plan, before, 'input is never mutated');
      t.diagnostic(JSON.stringify({ lessonReaderCase: `matrix-${count}-${shape}-${editedField}`, input: effectiveInputForLesson(next, next.sessions[0], context), expected: result }));
    });
  }
}

test('shared-date reset removes only selected scalar overrides and inherits the shared date settings', () => {
  const plan = adjacentFixture();
  Object.assign(plan.sessions[0], { startTime: '14:00', endTime: '15:00', teacherCatalogId: teacher, classroomCatalogId: null });
  const peer = { ...plan.sessions[0], id: 'peer', sessionKey: 'peer', startTime: '16:00', endTime: '17:00' };
  plan.sessions.push(peer); plan.sessionSchedules['2026-10-05'] = { startTime: '12:00', endTime: '13:00', classroomCatalogId: room, opaque: true };
  const next = setAuthoredLegacyLessonFields(plan, 'source', {}, {}, true);
  assert.deepEqual(next.sessions[1], peer); assert.deepEqual(next.sessionSchedules, plan.sessionSchedules);
  assert.deepEqual(resolved(next).values, { startTime: '12:00', endTime: '13:00', teacherCatalogId: teacher, classroomCatalogId: room });
});
