import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedLessonDisplayOrdinals, normalizedLessonMonths } from '../src/features/operations/normalized-lesson-display.ts';

const range = {dateFrom:'2026-10-01',dateTo:'2026-10-31'};
const row = (id,date='2026-10-02',patch={}) => ({id,sessionKey:`stable-${id}`,date,startTime:'19:30',scheduleState:'active',revision:4,sessionNumber:null,...patch});

test('normalized monthly display counts actual active and makeup lessons only, without mutating stored data', () => {
  const rows = ['active','exception','makeup','skipped','tbd'].map((state,index) => row(`row-${index}`,`2026-10-0${index+1}`,{scheduleState:state,sessionNumber:99}));
  const before = structuredClone(rows);
  for (const entry of rows) Object.freeze(entry);
  Object.freeze(rows);
  assert.deepEqual([...normalizedLessonDisplayOrdinals(rows,range).values()],[1,null,2,null,null]);
  assert.deepEqual(rows,before);
});

test('normalized multiple lessons on a day sort by time then stable key, independent of row order', () => {
  const rows = [row('late'),row('tie-b','2026-10-02',{startTime:'17:00'}),row('unknown','2026-10-02',{startTime:''}),row('tie-a','2026-10-02',{startTime:'17:00'}),row('earlier-date','2026-10-01')];
  const map = normalizedLessonDisplayOrdinals(rows,range);
  assert.deepEqual(rows.map(entry=>map.get(entry.id)),[4,3,5,2,1]);
  const reversed = normalizedLessonDisplayOrdinals([...rows].reverse(),range);
  assert.deepEqual(rows.map(entry=>reversed.get(entry.id)),[4,3,5,2,1]);
});

for (const [name,patch] of [
  ['partial range',{dateFrom:'2026-10-02',dateTo:'2026-10-31'}],
  ['unfinished month',{dateFrom:'2026-10-01',dateTo:'2026-10-30'}],
  ['cross-month range',{dateFrom:'2026-09-30',dateTo:'2026-10-31'}],
  ['invalid date',{dateFrom:'2026-10-01',dateTo:'2026-10-32'}],
  ['wrong response month',{dateFrom:'2026-11-01',dateTo:'2026-11-30'}],
  ['unknown range',null],
]) test(`normalized display leaves ${name} unnumbered`, () => {
  assert.equal(normalizedLessonDisplayOrdinals([row('one')],patch).get('one'),null);
});

for (const [name,rows] of [
  ['duplicate UUID',[row('one'),row('one','2026-10-03')]],
  ['duplicate stable key',[row('one'),row('two','2026-10-03',{sessionKey:'stable-one'})]],
  ['unknown state',[row('one'),row('two','2026-10-03',{scheduleState:'mystery'})]],
  ['invalid time',[row('one'),row('two','2026-10-03',{startTime:'24:01'})]],
  ['invalid date',[row('one'),row('two','2026-10-32')]],
]) test(`normalized display does not fabricate ordinals for ${name}`, () => {
  assert.ok([...normalizedLessonDisplayOrdinals(rows,range).values()].every(value=>value===null));
});

test('normalized display accepts a complete leap-February and does not predict missing dates', () => {
  const result = normalizedLessonDisplayOrdinals([row('one','2028-02-29')],{dateFrom:'2028-02-01',dateTo:'2028-02-29'});
  assert.deepEqual([...result],[['one',1]]);
  assert.equal(normalizedLessonDisplayOrdinals([],{dateFrom:'2026-11-01',dateTo:'2026-11-30'}).size,0);
});


test('month navigation separates legacy cross-month metadata into calendar hints without mutation',()=>{
 const periods=[{id:'july',startDate:'2026-06-29',endDate:'2026-07-31'},{id:'jan',startDate:'2026-12-28',endDate:'2027-01-29'}];
 const before=structuredClone(periods);
 const months=normalizedLessonMonths(periods,'2027-01','2026-10');
 assert.deepEqual(months.map(row=>row.month),['2026-06','2026-07','2026-10','2026-12','2027-01']);
 assert.deepEqual(months.at(-1),{id:'read-month-2027-01',month:'2027-01',startDate:'2027-01-01',endDate:'2027-01-31'});
 assert.deepEqual(periods,before);
});
test('month navigation ignores invalid hints and handles empty and leap ranges',()=>{
 assert.deepEqual(normalizedLessonMonths([{startDate:'2026-02-30',endDate:'2026-03-31'},{startDate:'2026-08-01',endDate:'2026-07-31'}],'invalid',null),[]);
 assert.deepEqual(normalizedLessonMonths([],'2028-02','2028-02'),[{id:'read-month-2028-02',month:'2028-02',startDate:'2028-02-01',endDate:'2028-02-29'}]);
 assert.equal(normalizedLessonMonths([{startDate:'9999-12-01',endDate:'9999-12-31'}],'9999-12',null).length,1);
});
