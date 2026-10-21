import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyLessonMonthRange, newLegacyLessonMonthError, prepareLegacyLessonMonth, suggestedLegacyLessonMonth } from '../src/features/operations/legacy-lesson-month.ts';
import { buildSchedulePlanForSave } from '../src/lib/class-schedule-planner.js';

const period = (id, month, startDate, endDate) => ({ id, month, label: `${month}월`, startDate, endDate });
const stored = { selectedDays: [2, 4], billingPeriods: [
  period('old-october', 10, '2025-10-01', '2025-10-31'),
  period('november', 11, '2026-11-03', '2026-11-26'),
  period('december', 12, '2026-12-01', '2026-12-24'),
] };

test('explicit year-month backfills a missing October without changing historical billing months', () => {
  const original = structuredClone(stored);
  const result = prepareLegacyLessonMonth(stored, '2026-10', 'new-october');
  assert.equal(result.error, '');
  assert.deepEqual(result.period, period('new-october', 10, '2026-10-01', '2026-10-29'));
  const next = { ...stored, billingPeriods: [...stored.billingPeriods, result.period] };
  assert.equal(newLegacyLessonMonthError(next, stored), '');
  const generated = buildSchedulePlanForSave(next);
  const rows = generated.sessions.filter(row => row.billingId === 'new-october');
  assert.equal(rows.length, 9);
  assert.ok(rows.every(row => row.date.startsWith('2026-10-') && row.billingLabel === '10월'));
  assert.deepEqual(stored, original);
});

test('year boundary and leap February use the chosen calendar year', () => {
  assert.equal(suggestedLegacyLessonMonth(stored, '2026-10-21'), '2027-01');
  assert.equal(suggestedLegacyLessonMonth({ billingPeriods: [...stored.billingPeriods].reverse() }, '2026-10-21'), '2027-01');
  assert.equal(suggestedLegacyLessonMonth({}, '2026-10-21'), '2026-10');
  assert.deepEqual(prepareLegacyLessonMonth(stored, '2027-01', 'jan').period, period('jan', 1, '2027-01-05', '2027-01-28'));
  assert.deepEqual(legacyLessonMonthRange('2028-02'), { startDate: '2028-02-01', endDate: '2028-02-29', month: 2, label: '2월' });
  assert.equal(legacyLessonMonthRange('2027-02').endDate, '2027-02-28');
});

test('existing month, overlapping cycle and repeated addition are blocked, other years remain available', () => {
  for (const month of ['2025-10', '2026-11', '2026-12']) assert.match(prepareLegacyLessonMonth(stored, month).error, /이미 있습니다/);
  const first = prepareLegacyLessonMonth(stored, '2026-10', 'oct').period;
  assert.match(prepareLegacyLessonMonth({ ...stored, billingPeriods: [...stored.billingPeriods, first] }, '2026-10').error, /이미 있습니다/);
  const crossMonth = { selectedDays: [2], billingPeriods: [period('cycle', 6, '2026-05-05', '2026-06-02')] };
  assert.match(prepareLegacyLessonMonth(crossMonth, '2026-05').error, /이미 있습니다/);
  assert.match(prepareLegacyLessonMonth(crossMonth, '2026-06').error, /이미 있습니다/);
  assert.equal(newLegacyLessonMonthError(crossMonth, crossMonth), '', 'historical cross-month definitions remain allowed');
});

test('new period validation rejects mismatched month, dates and duplicate billing ownership', () => {
  const valid = prepareLegacyLessonMonth(stored, '2026-10', 'oct').period;
  for (const patch of [
    { month: 1, label: '1월' }, { label: '2026년 10월' }, { endDate: '2027-10-29' },
    { startDate: '2026-09-30' }, { startDate: '' }, { endDate: '2026-10-00' },
    { startDate: '2026-10-20', endDate: '2026-10-01' },
  ]) assert.match(newLegacyLessonMonthError({ billingPeriods: [...stored.billingPeriods, { ...valid, ...patch }] }, stored), /일치해야/);
  assert.match(newLegacyLessonMonthError({ billingPeriods: [...stored.billingPeriods, valid, { ...valid, id: 'second' }] }, stored), /이미 있습니다/);
  const invalidFebruary = { billingPeriods: [period('invalid', 2, '2026-02-01', '2026-02-31')] };
  assert.match(newLegacyLessonMonthError(invalidFebruary, {}), /일치해야/);
  assert.match(newLegacyLessonMonthError({ billingPeriods: [{ ...valid, startDate: '2027-10-01', endDate: '2027-10-29' }] }, stored, new Map([['oct', '2026-10']])), /일치해야/);
  const unrelatedDraft = { billingPeriods: [period('legacy-cycle', 10, '2026-09-29', '2026-10-27')] };
  assert.equal(newLegacyLessonMonthError(unrelatedDraft, {}, new Map()), '', 'only the explicit month-add flow introduces this guard');
});

test('empty or malformed month and missing weekly days cannot create a draft period', () => {
  for (const month of ['', '2026-00', '2026-13', '2026-1', '0000-10', '2026-10-01']) {
    const result = prepareLegacyLessonMonth(stored, month);
    assert.equal(result.period, null);
    assert.match(result.error, /연월/);
  }
  assert.match(prepareLegacyLessonMonth({ selectedDays: [], billingPeriods: [] }, '2026-10').error, /요일/);
});
