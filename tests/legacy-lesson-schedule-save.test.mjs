import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedulePlanForSave, normalizeSchedulePlan, applyCalendarDateSubstitution } from '../src/lib/class-schedule-planner.js';
import { effectiveOperatingSlots } from '../src/features/academic/timetable-conflicts.ts';
import * as legacyValidation from '../src/features/operations/schedule-only-plan.ts';

const occupancy = { startTime: '19:20', endTime: '21:20', teacherCatalogId: 'teacher', classroomCatalogId: 'room' };
const plan = { selectedDays: [2, 0], billingPeriods: [{ id: 'oct', month: 10, startDate: '2026-09-29', endDate: '2026-10-27' }], sessionStates: {
  '2026-10-13': { state: 'exception' }, '2026-10-18': { state: 'exception' }, '2026-10-09': { state: 'makeup' },
}, sessionSchedules: { '2026-10-09': occupancy } };

test('editing October leaves an untouched historical period with older linked makeup rows exactly intact', () => {
  const saved = buildSchedulePlanForSave({selectedDays:[2,0],billingPeriods:[
    {id:'apr',month:4,startDate:'2026-04-28',endDate:'2026-04-30'}, ...plan.billingPeriods,
  ],sessionStates:{'2026-04-28':{state:'exception',makeupDate:'2026-04-29'},'2026-04-29':{state:'exception'}}});
  // Older producers stored only the linked makeup on this non-recurring day.
  saved.sessions = saved.sessions.filter(s => s.date !== '2026-04-29' || s.scheduleState === 'makeup');
  saved.sessions.find(s => s.date === '2026-04-29').teacherNote = 'original history';
  const baseline = normalizeSchedulePlan(saved);
  const rebuilt = buildSchedulePlanForSave({...baseline,sessionStates:{...baseline.sessionStates,...plan.sessionStates},sessionSchedules:plan.sessionSchedules});
  assert.equal(typeof legacyValidation.preserveUneditedLegacyPeriods, 'function');
  const result = legacyValidation.preserveUneditedLegacyPeriods(rebuilt,saved,baseline);
  assert.deepEqual(result.sessions.filter(s=>s.billingId==='apr'),saved.sessions.filter(s=>s.billingId==='apr'));
  assert.equal(result.sessions.filter(s=>s.billingId==='oct' && !['exception','skipped','tbd'].includes(s.scheduleState)).length,8);
  const edited = {...rebuilt,sessionStates:{...rebuilt.sessionStates,'2026-04-29':{state:'tbd'}}};
  assert.deepEqual(legacyValidation.preserveUneditedLegacyPeriods(edited,saved,baseline).sessions.filter(s=>s.billingId==='apr'),edited.sessions.filter(s=>s.billingId==='apr'));
});

test('two cancellations and one makeup persist eight lessons with exact makeup resources through reload', () => {
  const saved = buildSchedulePlanForSave(normalizeSchedulePlan(plan));
  const reload = buildSchedulePlanForSave(normalizeSchedulePlan(saved));
  for (const result of [saved, reload]) {
    const lessons = result.sessions.filter(s => !['exception', 'skipped', 'tbd'].includes(s.scheduleState));
    assert.equal(lessons.length, 8);
    assert.deepEqual(lessons.map(s => [s.date, s.sessionNumber]), [['2026-09-29',1],['2026-10-04',2],['2026-10-06',3],['2026-10-09',4],['2026-10-11',5],['2026-10-20',6],['2026-10-25',7],['2026-10-27',8]]);
    const makeup = result.sessions.find(s => s.date === '2026-10-09');
    for (const [key, value] of Object.entries(occupancy)) assert.equal(makeup[key], value);
    assert.equal(result.sessions.find(s => s.date === '2026-10-13').scheduleState, 'exception');
  }
});

test('linked makeup uses the target date details and does not copy them to its cancelled source', () => {
  const draft = applyCalendarDateSubstitution({ ...plan, sessionStates: {} }, '2026-10-13', '2026-10-09');
  const saved = buildSchedulePlanForSave(draft);
  assert.equal(saved.sessions.find(s => s.date === '2026-10-09').startTime, '19:20');
  assert.equal(saved.sessions.find(s => s.date === '2026-10-13').startTime, undefined);
});

test('existing explicit session resources survive regeneration without being moved by renumbering', () => {
  const stored = buildSchedulePlanForSave({ ...plan, sessionStates: {}, sessionSchedules: {} });
  Object.assign(stored.sessions.find(s => s.date === '2026-10-13'), occupancy);
  const saved = buildSchedulePlanForSave({ ...stored, sessionStates: plan.sessionStates });
  assert.equal(saved.sessions.find(s => s.date === '2026-10-09').startTime, undefined);
  assert.equal(saved.sessions.find(s => s.date === '2026-10-13').startTime, '19:20');
});

test('legacy cancellation suppresses only the proven weekly slot on its own date', () => {
  const slot = { id:'live:legacy', classId:'class', sourceSlotId:null, weekday:2, startMinute:1160, endMinute:1280, teacherId:'teacher', classroomId:'room', classRevision:1 };
  const ref = { asOfDate:'2026-09-29', shadowSlots:[slot], datedSessions:[{ id:'cancel', classId:'class', sourceSlotId:null, inheritedWeeklySlotId:slot.id, date:'2026-10-13', state:'skipped', startMinute:null, endMinute:null, teacherId:null, classroomId:null, revision:0 }] };
  assert.deepEqual(effectiveOperatingSlots(ref,'2026-10-13'), []);
  assert.equal(effectiveOperatingSlots(ref,'2026-10-20').length, 1);
  assert.equal(effectiveOperatingSlots({...ref,datedSessions:[{...ref.datedSessions[0],classId:'other'}]},'2026-10-13').length,1);
});

test('save validation identifies new makeup without times while accepting unchanged historical rows and cancellations', () => {
  assert.equal(typeof legacyValidation.legacyLessonScheduleValidationError, 'function');
  const validate = legacyValidation.legacyLessonScheduleValidationError;
  const historical = { id:'past', date:'2026-03-31', scheduleState:'makeup', isForced:true };
  const old = { sessions:[historical] };
  assert.equal(validate({ sessions:[{...historical,sessionKey:'past'}] },old), '');
  assert.equal(validate({ sessions:[historical,{date:'2026-10-13',scheduleState:'exception'}] },old), '');
  assert.match(validate({sessions:[historical,{date:'2026-10-09',scheduleState:'makeup',isForced:true}]},old), /2026-10-09/);
  assert.equal(validate({sessions:[historical,{date:'2026-10-09',scheduleState:'makeup',isForced:true,...occupancy}]},old), '');
  assert.match(validate({sessions:[{date:'2026-10-09',scheduleState:'makeup',...occupancy,endTime:'18:00'}]},old), /종료/);
  assert.match(validate({sessions:[{date:'2026-10-09',scheduleState:'makeup',...occupancy,startTime:'19:75'}]},old), /시작·종료/);
});
