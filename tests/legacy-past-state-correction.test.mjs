import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLegacyPastStateCorrectionTarget, resolveLegacyPastStateCorrectionDraft,
  createLegacyPastStateCorrectionAction, legacyPastStateCorrectionErrorMessage } from '../src/features/operations/legacy-past-state-correction.ts';
import { applyCalendarDateToggle, normalizeSchedulePlan, buildSchedulePlanForSave } from '../src/lib/class-schedule-planner.js';

const row = (patch = {}) => ({ id: 'existing-past-row', date: '2026-10-01', state: 'skipped', scheduleState: 'skipped',
  isForced: false, originalDate: '', makeupDate: '', startTime: '17:00', endTime: '19:00',
  teacherCatalogId: 'synthetic-teacher', classroomCatalogId: 'synthetic-room',
  unknownWireKey: { retained: true }, ...patch });
const plan = (sessions = [row()]) => ({ version: 2, sessions, sessionStates: { '2026-10-01': { state: 'skipped' } },
  sessionSchedules: { '2026-10-01': { startTime: '17:00', endTime: '19:00', teacherCatalogId: 'synthetic-teacher', classroomCatalogId: 'synthetic-room' } } });
const resolve = value => resolveLegacyPastStateCorrectionTarget(value, 'existing-past-row', '2026-10-02');

test('past correction targets the exact saved regular row without normalizing or mutating it', () => {
  const saved = plan(), original = structuredClone(saved);
  const target = resolve(saved);
  assert.equal(target.sessionId, 'existing-past-row');
  assert.equal(target.date, '2026-10-01');
  assert.equal(target.currentState, 'skipped');
  assert.deepEqual(target.raw, original.sessions[0]);
  assert.deepEqual(saved, original);
});

for (const state of ['active', 'exception', 'skipped']) test(`existing ${state} retains stored occupancy without inferring it`, () => {
  const stored = row({ state, scheduleState: state });
  const target = resolve(plan([stored]));
  assert.equal(target.currentState, state);
  assert.deepEqual(target.raw, stored);
  assert.equal(target.raw.startTime, '17:00');
  assert.equal(target.raw.teacherCatalogId, 'synthetic-teacher');
});

test('future, today and invalid calendar dates cannot use past correction', () => {
  for (const date of ['2026-10-02', '2026-10-03', '2026-02-30', '2026-1-1', '', null]) {
    assert.equal(resolve(plan([row({ date })])), null, String(date));
  }
  assert.equal(resolveLegacyPastStateCorrectionTarget(plan(), 'existing-past-row', 'invalid'), null);
});

test('missing IDs, ambiguous dates and duplicated identities cannot identify a single row', () => {
  assert.equal(resolve(plan([])), null);
  assert.equal(resolve(plan([row({ id: '' })])), null);
  assert.equal(resolve(plan([row(), row({ id: 'other-id' })])), null);
  assert.equal(resolve(plan([row(), row({ date: '2026-09-29' })])), null);
  assert.equal(resolveLegacyPastStateCorrectionTarget(plan(), 'unrelated-row', '2026-10-02'), null);
});

test('forced, linked and unsupported states are excluded from regular state correction', () => {
  for (const patch of [{ isForced: true }, { isForced: 'true' }, { originalDate: '2026-09-29' },
    { makeupDate: '2026-10-08' }, { state: 'makeup', scheduleState: 'makeup' },
    { state: 'force_active', scheduleState: 'force_active' }, { state: 'tbd', scheduleState: 'tbd' },
    { state: 'cancelled', scheduleState: 'cancelled' }]) {
    assert.equal(resolve(plan([row(patch)])), null, JSON.stringify(patch));
  }
});

test('raw state follows the stored authoritative scheduleState and preserves all other fields', () => {
  const stored = row({ scheduleState: 'exception', state: 'active', memo: 'synthetic stored memo', sessionNumber: 7 });
  const target = resolve(plan([stored]));
  assert.equal(target.currentState, 'exception');
  assert.deepEqual(target.raw, stored);
});

test('malformed plans and row data fail closed', () => {
  for (const saved of [null, undefined, [], 'plan', {}, { sessions: 'rows' }, { sessions: [null, [], 'row'] }]) {
    assert.equal(resolve(saved), null, JSON.stringify(saved));
  }
  for (const patch of [{ id: 7 }, { id: ' existing-past-row ' }, { date: 20261001 }, { scheduleState: {} }]) {
    assert.equal(resolve(plan([row(patch)])), null, JSON.stringify(patch));
  }
});

test('incomplete stored occupancy cannot enter the separate correction path', () => {
  for (const patch of [{ startTime: undefined }, { endTime: '' }, { startTime: '19:00', endTime: '17:00' },
    { teacherCatalogId: '' }, { classroomCatalogId: '' }]) assert.equal(resolve(plan([row(patch)])), null);
});

test('whole-minute stored times retain the exact raw strings; names cannot replace catalog IDs', () => {
  for (const startTime of ['7:00', '07:00:00', '07:00:00.000']) {
    const stored = row({ startTime }); assert.equal(resolve(plan([stored])).raw.startTime, startTime);
  }
  assert.equal(resolve(plan([row({ startTime: '17:00:01' })])), null);
  assert.equal(resolve(plan([row({ endTime: '24:00' })])).raw.endTime, '24:00');
  assert.equal(resolve(plan([row({ endTime: '24:01' })])), null);
  assert.equal(resolve(plan([row({ teacherCatalogId: undefined, teacherName: 'synthetic named teacher' })])), null);
  assert.equal(resolve(plan([row({ classroomCatalogId: undefined, classroomName: 'synthetic named room' })])), null);
});

function generatedStateFixture() {
  const saved = buildSchedulePlanForSave({ selectedDays: [2, 4],
    billingPeriods: [{ id: 'october', month: 10, startDate: '2026-10-01', endDate: '2026-10-29' }],
    sessionStates: { '2026-10-01': { state: 'skipped' }, '2026-10-06': { state: 'exception' } },
    sessionSchedules: { '2026-10-01': { startTime: '17:00', endTime: '19:00', teacherCatalogId: 'synthetic-teacher', classroomCatalogId: 'synthetic-room' } },
  });
  const baseline = normalizeSchedulePlan(saved), target = resolveLegacyPastStateCorrectionTarget(saved,
    saved.sessions.find(row => row.date === '2026-10-01').id, '2026-10-02');
  const draft = normalizeSchedulePlan(applyCalendarDateToggle(baseline, '2026-10-01', { hasSession: true, hasBaseSession: true, isMakeup: false }));
  return { saved, baseline, target, draft };
}

test('a clean accepted draft and actual generated single-state draft can use correction', () => {
  const { baseline, target, draft } = generatedStateFixture();
  assert.deepEqual(resolveLegacyPastStateCorrectionDraft(baseline, baseline, target), { dirty: false, state: 'active' });
  assert.deepEqual(resolveLegacyPastStateCorrectionDraft(baseline, draft, target), { dirty: true, state: 'active' });
});

test('any unrelated time, resource, date, identity, weekly, state or link draft change is rejected', () => {
  for (const mutate of [
    plan => { plan.sessionSchedules['2026-10-01'].startTime = '18:00'; },
    plan => { plan.sessions.find(row => row.date === '2026-10-01').teacherCatalogId = 'different'; },
    plan => { plan.sessions.find(row => row.date === '2026-10-08').date = '2026-10-09'; },
    plan => { plan.sessions.find(row => row.date === '2026-10-08').id = 'different'; },
    plan => { plan.sessions.find(row => row.date === '2026-10-08').isForced = true; },
    plan => { plan.sessions.find(row => row.date === '2026-10-01').originalDate = '2026-09-29'; },
    plan => { plan.selectedDays = [2]; },
    plan => { plan.sessionStates['2026-10-06'] = { state: 'active' }; },
    plan => { plan.billingPeriods[0].endDate = '2026-11-03'; },
    plan => { plan.sessions.push({ ...plan.sessions[0], id: 'new' }); },
    plan => { plan.sessions.pop(); },
    plan => { plan.sessionStates['2026-10-01'] = { state: 'active', memo: 'new reason belongs elsewhere' }; },
  ]) {
    const { baseline, target, draft } = generatedStateFixture(); mutate(draft);
    assert.equal(resolveLegacyPastStateCorrectionDraft(baseline, draft, target), null);
  }
});

function rpcFixture(count = 2) {
  const expectedPlan = plan(), value = { classId: 'ab000000-0000-4000-8000-000000000001', expectedPlan,
    target: resolve(expectedPlan), state: 'active', reason: 'synthetic historical state correction' };
  const preview = { kind: 'past_lesson_state_correction', classId: value.classId, lessonId: value.target.sessionId,
    date: value.target.date, expectedState: 'skipped', state: 'active', planHash: 'a'.repeat(64),
    reviewRequired: count > 0, unknownOccupancyReviewHash: 'b'.repeat(64), unknownOccupancyCount: count,
    warnings: count ? [{ code: 'unknown_occupancy', count }] : [] };
  const calls = [], controls = { failure: null, malformed: null };
  const action = createLegacyPastStateCorrectionAction({ createRequestKey: () => 'ab000000-0000-4000-8000-000000000009',
    rpc: async (name, args) => {
      calls.push({ name, args: structuredClone(args) });
      if (controls.failure) return { data: null, error: controls.failure };
      if (controls.malformed !== null) return { data: controls.malformed, error: null };
      return { data: name.startsWith('preview_') ? structuredClone(preview)
        : { ...preview, reviewRequired: false, requestKey: args.p_request_key, outcome: 'applied', notifications: { state: 'not_requested' } }, error: null };
    },
  });
  return { value, preview, calls, controls, action };
}

test('preview transmits the exact raw plan and narrow identity/state/reason fields without a write key', async () => {
  const { value, calls, action } = rpcFixture();
  const before = structuredClone(value.expectedPlan);
  await action.preview(value);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'preview_past_lesson_state_correction_v1');
  assert.deepEqual(calls[0].args, { p_class_id: value.classId, p_expected_schedule_plan: before,
    p_lesson_id: value.target.sessionId, p_session_date: value.target.date, p_expected_state: 'skipped',
    p_schedule_state: 'active', p_reason: value.reason, p_unknown_occupancy_review_hash: null,
    p_acknowledge_unknown_occupancy: false });
  assert.deepEqual(value.expectedPlan, before);
});

test('unknown warnings require explicit acknowledgement and preserve exact reviewed hash on commit', async () => {
  const { value, calls, action } = rpcFixture();
  const reviewed = await action.preview(value);
  await assert.rejects(action.save(value, reviewed, false), { code: 'past_state_correction_review_required' });
  assert.equal(calls.length, 1);
  await action.save(value, reviewed, true);
  assert.equal(calls[1].name, 'save_past_lesson_state_correction_v1');
  assert.deepEqual(calls[1].args.p_expected_schedule_plan, value.expectedPlan);
  assert.equal(calls[1].args.p_unknown_occupancy_review_hash, 'b'.repeat(64));
  assert.equal(calls[1].args.p_acknowledge_unknown_occupancy, true);
  assert.equal(calls[1].args.p_request_key, 'ab000000-0000-4000-8000-000000000009');
  assert.equal(Object.hasOwn(calls[1].args, 'p_patch'), false);
});

test('unknown save outcomes permit a manual retry with the same key and no automatic write', async () => {
  const { value, calls, controls, action } = rpcFixture();
  const reviewed = await action.preview(value);
  controls.failure = new Error('synthetic timeout');
  await assert.rejects(action.save(value, reviewed, true));
  assert.equal(calls.length, 2);
  controls.failure = null; await action.save(value, reviewed, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].args.p_request_key, calls[2].args.p_request_key);
});

test('zero-warning explicit save still acknowledges the reviewed hash required by the server', async () => {
  const { value, calls, action } = rpcFixture(0);
  const reviewed = await action.preview(value);
  await action.save(value, reviewed, false);
  assert.equal(calls[1].args.p_acknowledge_unknown_occupancy, true);
  assert.equal(calls[1].args.p_unknown_occupancy_review_hash, reviewed.unknownOccupancyReviewHash);
});

test('changed reason, target state or raw version invalidates a previous review before any write', async () => {
  for (const change of [value => { value.reason += ' edited'; }, value => { value.state = 'exception'; },
    value => { value.expectedPlan.version = 3; }]) {
    const { value, calls, action } = rpcFixture(); const reviewed = await action.preview(value); change(value);
    await assert.rejects(action.save(value, reviewed, true), { code: 'past_state_correction_review_stale' });
    assert.equal(calls.length, 1);
  }
});

test('a forged review and malformed success envelope cannot become a successful correction', async () => {
  const { value, calls, controls, action } = rpcFixture();
  const reviewed = await action.preview(value);
  await assert.rejects(action.save(value, { ...reviewed }, true), { code: 'past_state_correction_review_stale' });
  assert.equal(calls.length, 1);
  for (const malformed of [{}, '<html>error</html>', { ...reviewed, reviewRequired: false, outcome: 'applied' }]) {
    controls.malformed = malformed;
    await assert.rejects(action.save(value, reviewed, true), { code: 'past_state_correction_response_invalid' });
  }
});

test('known collisions block without a commit and UI copy never echoes a raw server message', async () => {
  const { value, calls, controls, action } = rpcFixture();
  controls.failure = { code: '23P01', message: 'RAW synthetic internal collision details' };
  await assert.rejects(action.preview(value), { code: '23P01' });
  assert.equal(calls.length, 1);
  assert.match(legacyPastStateCorrectionErrorMessage(controls.failure), /겹치는 일정/);
  assert.doesNotMatch(legacyPastStateCorrectionErrorMessage(controls.failure), /RAW/);
  assert.match(legacyPastStateCorrectionErrorMessage(new Error('RAW internal timeout'), true), /정정 결과를 확인하지 못했습니다/);
});

test('business stale messages stay distinct from genuine database concurrency and unknown constraints', () => {
  for (const message of ['agent_stale', 'agent_review_stale', 'class_schedule_stale']) {
    assert.match(legacyPastStateCorrectionErrorMessage({ code: 'P0001', message }), /일정 정보가 바뀌었습니다/);
  }
  assert.doesNotMatch(legacyPastStateCorrectionErrorMessage({ code: '40001', message: 'serialization failure' }), /일정 정보가 바뀌었습니다/);
  assert.doesNotMatch(legacyPastStateCorrectionErrorMessage({ code: '23514', message: 'unknown constraint' }), /정정 상태와 사유/);
  assert.match(legacyPastStateCorrectionErrorMessage({ code: 'P0001', message: 'agent_approval_workflow_required' }), /휴보강 승인/);
});
