import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { effectiveOperatingSlots } from '../src/features/academic/timetable-conflicts.ts';

const sql = name => readFileSync(new URL(`../supabase/tests/${name}.sql`, import.meta.url), 'utf8');
const kstDay = instant => new Date(Date.parse(instant) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
// Evaluate only this fixture's documented date expression, not the SQL writer.
function mixedFixtureDate(instant) {
  const source = sql('class_basic_info_input_policy_test');
  const expression = source.match(/'id','new-mixed-conflict','date',([^,]+)/)?.[1];
  if (/^'\d{4}-\d{2}-\d{2}'$/.test(expression ?? '')) return expression.slice(1, -1);
  assert.equal(expression, 'pg_temp.basic_conflict_date()');
  assert.match(source, /select date_trunc\('week',now\(\) at time zone 'Asia\/Seoul'\)::date \+ 12/);
  const day = new Date(`${kstDay(instant)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7) + 12);
  return day.toISOString().slice(0, 10);
}
const weekly = { id: 'weekly-peer', classId: 'active-peer', weekday: 6,
  startMinute: 990, endMinute: 1080, teacherId: 'teacher', classroomId: 'room', sourceSlotId: null };
const reference = asOfDate => ({ occupancyValidationVersion: 2, asOfDate,
  shadowSlots: [weekly], shadowClasses: [], catalogs: { teachers: [], classrooms: [] },
  unresolvedOccupancies: [], shadowFingerprint: 'synthetic', datedSessions: [],
  datedUnresolvedOccupancies: [], datedFingerprint: 'synthetic', datedComplete: true, complete: true });

test('basic mixed-conflict fixture always includes the active Saturday peer across KST rollovers', () => {
  for (const instant of ['2026-10-31T14:59:59Z', '2026-10-31T15:00:00Z', '2026-11-01T03:00:00Z',
    '2026-12-31T15:00:00Z', '2028-02-28T15:00:00Z', '2028-02-29T15:00:00Z']) {
    const date = mixedFixtureDate(instant);
    assert.ok(date > kstDay(instant), `${instant}: mixed conflict must be future, got ${date}`);
    assert.equal(new Date(`${date}T00:00:00Z`).getUTCDay(), 6);
    assert.deepEqual(effectiveOperatingSlots(reference(kstDay(instant)), date).map(row => row.classId), ['active-peer']);
  }
});

test('fixed past date loses only weekly occupancy at the KST boundary, not stored dated history', () => {
  assert.equal(kstDay('2026-10-31T14:59:59Z'), '2026-10-31');
  assert.equal(kstDay('2026-10-31T15:00:00Z'), '2026-11-01');
  assert.equal(effectiveOperatingSlots(reference('2026-10-31'), '2026-10-31').length, 1);
  assert.deepEqual(effectiveOperatingSlots(reference('2026-11-01'), '2026-10-31'), []);
  const dated = { ...weekly, id: 'retained', date: '2026-10-31', state: 'active', revision: 0 };
  assert.equal(effectiveOperatingSlots({ ...reference('2026-11-01'), datedSessions: [dated] }, dated.date).length, 1);
});

test('close SQL fixtures retain active uncertainty and pre-close history beside future release checks', () => {
  const scoped = sql('timetable_scoped_occupancy_test');
  assert.match(scoped, /'active off-weekday legacy','영어','수강'/);
  assert.match(scoped, /closed future unknown-time occupancy is released/);
  assert.match(scoped, /closed past unknown-time occupancy remains conservative/);
  assert.match(scoped, /mixed active resources remain conservative/);
  const operational = sql('timetable_operational_conflicts_test');
  assert.match(operational, /closed class releases future actual makeup occupancy/);
  assert.match(operational, /closing projection preserves raw makeup history/);
  assert.match(operational, /closing one class preserves other active occupancy/);
  const basic = sql('class_basic_info_input_policy_test');
  assert.match(basic, /'23P01','timetable_resource_conflict','separate mixed-plan writer policy/);
  assert.match(basic, /rejected mixed save leaves no success receipt/);
  assert.match(basic, /rejected mixed save preserves all eighty session objects/);
});
