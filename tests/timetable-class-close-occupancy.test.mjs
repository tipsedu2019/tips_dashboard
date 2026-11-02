import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { effectiveOperatingSlots, findOperatingConflicts } from '../src/features/academic/timetable-conflicts.ts';
import { requireTimetableOperatingReference } from '../src/features/academic/timetable-plan-service.ts';

const migration = new URL('../supabase/migrations/20261031120000_class_close_occupancy_release.sql', import.meta.url);
test('closed-class release is installed atomically in both operating readers without replacing validation', () => {
  assert.ok(existsSync(migration), 'forward close-release migration is required');
  const sql = readFileSync(migration, 'utf8');
  assert.match(sql, /^begin;/i);
  assert.match(sql, /commit;\s*$/i);
  for (const name of ['read_timetable_operating_reference_v1', 'read_makeup_operating_reference_v1']) {
    const body = sql.split(`function dashboard_private.${name}`)[1]?.split('end $f$;')[0];
    assert.ok(body, name);
    assert.match(body, /project_class_close_occupancy_v1\(/);
    assert.match(body, /dated_hash:=md5\(\(dated\|\|blockers\|\|raw\)::text\)/);
  }
  assert.doesNotMatch(sql, /(?:create or replace|drop) function dashboard_private\.(?:validate_timetable_operating_reference_v1|assert_timetable_operational_conflicts_v1|timetable_operating_finalize_v1)/i);
  assert.doesNotMatch(sql, /(?:delete from|update) public\.(?:class_lesson_sessions|classes|makeup_requests)\b/i);
  assert.doesNotMatch(sql, /disable\s+trigger|grant\s+.+\s+to\s+(?:authenticated|anon)/i);
});

test('release uses the stored Korean close day, conservative missing-date fallback and private access', () => {
  assert.ok(existsSync(migration));
  const sql = readFileSync(migration, 'utf8');
  assert.match(sql, /closed_at at time zone 'Asia\/Seoul'/);
  assert.match(sql, /coalesce\(\(c\.closed_at at time zone 'Asia\/Seoul'\)::date,as_of_date\)/);
  assert.match(sql, /e\.value->>'date' is null/);
  assert.match(sql, /revoke all on function dashboard_private\.project_class_close_occupancy_v1\(jsonb\)/);
  assert.doesNotMatch(sql.split('function dashboard_private.project_class_close_occupancy_v1')[1]?.split('end $f$;')[0]?.replace(/--[^\n]*/g, '') ?? '', /closed_by\s+(?:is|=)/i);
});

const period = { startDate: '2026-10-30', endDate: '2026-11-06' };
const candidate = { id: 'new', itemId: 'new-item', planId: 'synthetic-plan', sourceSlotId: null,
  weekday: 6, startMinute: 900, endMinute: 960, teacherId: 'teacher', classroomId: 'room' };
const session = (id, date, state = 'active', classId = 'closed') => ({ id, classId, sourceSlotId: null,
  date, state, startMinute: 900, endMinute: 960, teacherId: 'teacher', classroomId: 'room', revision: 1 });
const reference = (datedSessions = [], datedUnresolvedOccupancies = []) => ({ occupancyValidationVersion: 2,
  asOfDate: '2026-10-31', shadowSlots: [], shadowClasses: [], catalogs: { teachers: [], classrooms: [] },
  unresolvedOccupancies: [], shadowFingerprint: 'release-v1', datedSessions, datedUnresolvedOccupancies,
  datedFingerprint: 'dated-release-v1', datedComplete: datedUnresolvedOccupancies.length === 0, complete: true });

test('real consumer accepts released producer shape without reintroducing retained history', () => {
  const history = ['active', 'exception', 'makeup', 'skipped', 'tbd'].flatMap((state, index) =>
    [session(`past-${index}`, '2026-10-30', state), session(`today-${index}`, '2026-10-31', state), session(`future-${index}`, '2026-11-01', state)]);
  const original = structuredClone(history);
  // A wire fixture of the SQL projection, not an executed SQL result.
  const wire = reference(history.filter(row => row.date === '2026-10-30'));
  const parsed = requireTimetableOperatingReference(wire);
  assert.deepEqual(findOperatingConflicts([candidate], parsed, period), []);
  assert.deepEqual(effectiveOperatingSlots(parsed, '2026-10-31'), []);
  assert.equal(effectiveOperatingSlots(parsed, '2026-10-30').length, 3);
  assert.deepEqual(history, original, 'operating reference does not mutate lesson history');
});

test('fresh reactivated reference restores teacher/room conflicts; other classes always remain protected', () => {
  const row = session('restored', '2026-10-31');
  assert.deepEqual(findOperatingConflicts([candidate], requireTimetableOperatingReference(reference()), period), []);
  for (const classId of ['closed', 'unrelated-active']) {
    const active = requireTimetableOperatingReference(reference([{ ...row, classId }]));
    assert.deepEqual(findOperatingConflicts([candidate], active, period).map(conflict => conflict.kind).sort(), ['classroom', 'teacher']);
    assert.equal(effectiveOperatingSlots(active, row.date).length, 1);
  }
});

test('date-unknown blockers and unrelated incomplete reservations stay conservative', () => {
  const blocker = { classId: 'closed', label: '합성 날짜 확인 필요', scope: 'all', resourceId: null,
    reason: 'incomplete_read', date: null, teacherId: 'teacher', classroomId: 'room' };
  assert.equal(findOperatingConflicts([candidate], requireTimetableOperatingReference(reference([], [blocker])), period)[0].kind, 'unresolved');
  assert.equal(findOperatingConflicts([candidate], requireTimetableOperatingReference(reference([], [{ ...blocker, classId: 'active', date: '2026-10-31' }])), period)[0].kind, 'unresolved');
});
