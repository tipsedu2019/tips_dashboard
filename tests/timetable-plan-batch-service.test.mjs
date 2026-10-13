import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTimetablePlanService, requireTimetableBatchResult } from '../src/features/academic/timetable-plan-service.ts';
import { withRpcQueryControls } from './helpers/rpc-query-fixture.mjs';
import { buildPlacementFormEdit, placementFormDefaults } from '../src/features/academic/timetable-plan-interaction.ts';

const item = (id, revision = 2) => ({ id, planId: 'plan', revision, name: id, subject: '영어', subjectAreaKey: null, grade: '', capacity: null, tuition: null, defaultTeacherId: 'teacher', defaultClassroomId: 'room', durationMinutes: 60, pendingSlots: [], sourceClassId: null, state: 'draft', appliedClassId: null, appliedTransferId: null, appliedAt: null });
const slot = (id, itemId, startMinute) => ({ id, itemId, planId: 'plan', weekday: 1, startMinute, endMinute: startMinute + 60, teacherId: 'teacher', classroomId: 'room', sourceSlotId: null });
const draft = value => { const { revision, sourceClassId, state, appliedClassId, appliedTransferId, appliedAt, ...fields } = value; void revision; void sourceClassId; void state; void appliedClassId; void appliedTransferId; void appliedAt; return fields; };
function fixture() {
  const items = [item('a'), item('b')], slots = [slot('sa', 'a', 660), slot('sb', 'b', 600)];
  const command = { operation: 'save_batch', planId: 'plan', expectedMetaRevision: 3, expectedChangeSequence: 8, expectedShadowFingerprint: 'f', requestKey: 'immutable-batch', edits: items.map((value, index) => ({ operation: 'save', item: draft(value), expectedItemRevision: 1, slots: [slots[index]] })) };
  const snapshot = { plan: { id: 'plan', name: '다음 학기', state: 'draft', metaRevision: 3, changeSequence: 9, targetStartDate: null, targetEndDate: null }, items, slots, appliedSnapshots: [], members: [], permissions: { canManage: true, canEdit: true, canTransfer: true }, capacity: { itemCount: 2, slotCount: 2, maxItems: 500, maxSlots: 2000, exceeded: false }, asOfDate: '2026-10-13', shadowSlots: [], shadowClasses: [], catalogs: { teachers: [], classrooms: [] }, unresolvedOccupancies: [], shadowFingerprint: 'f', datedSessions: [], datedUnresolvedOccupancies: [], datedFingerprint: 'd', datedComplete: true, complete: true };
  const result = { planId: 'plan', requestKey: command.requestKey, committedMetaRevision: 3, committedChangeSequence: 9, acknowledgements: items.map(value => ({ itemId: value.id, operation: 'save', itemRevision: value.revision })), snapshot };
  return { command: structuredClone(command), result: structuredClone(result) };
}

test('whole final-state swap uses one existing RPC and accepts complete acknowledgements', async () => {
  const { command, result } = fixture(), calls = [];
  const service = createTimetablePlanService({ actorScope: 'admin', client: withRpcQueryControls({ rpc(name, args) { calls.push({ name, args }); return Promise.resolve({ data: result, error: null }); } }) });
  assert.deepEqual(await service.saveBatch(command), result);
  assert.deepEqual(calls, [{ name: 'mutate_timetable_plan_item_v1', args: { p_command: command } }]);
});

test('batch mixed create and delete require complete target acknowledgements', () => {
  const { command, result } = fixture();
  command.edits[0].expectedItemRevision = null;
  command.edits[1] = { operation: 'delete', itemId: 'b', expectedItemRevision: 1 };
  result.acknowledgements = [{ itemId: 'a', operation: 'save', itemRevision: 1 }, { itemId: 'b', operation: 'delete', itemRevision: null }];
  result.snapshot.items = [item('a', 1)]; result.snapshot.slots = [result.snapshot.slots[0]];
  result.snapshot.capacity = { ...result.snapshot.capacity, itemCount: 1, slotCount: 1 };
  assert.deepEqual(requireTimetableBatchResult(result, command), result);
  result.snapshot.items.push(item('b'));
  assert.throws(() => requireTimetableBatchResult(result, command), /timetable_plan_response_invalid/);
});

for (const [name, mutate] of [
  ['missing target', r => r.acknowledgements.pop()],
  ['duplicate target', r => { r.acknowledgements[1] = r.acknowledgements[0]; }],
  ['wrong operation', r => { r.acknowledgements[0].operation = 'delete'; }],
  ['wrong target revision', r => { r.acknowledgements[0].itemRevision = 3; }],
  ['wrong request key', r => { r.requestKey = 'other'; }],
  ['wrong plan', r => { r.planId = 'other'; }],
  ['uncommitted sequence', r => { r.committedChangeSequence = 8; }],
  ['snapshot receipt sequence mismatch', r => { r.snapshot.plan.changeSequence = 10; }],
  ['snapshot fingerprint mismatch', r => { r.snapshot.shadowFingerprint = 'other'; }],
  ['missing saved item', r => r.snapshot.items.pop()],
  ['different saved slot', r => { r.snapshot.slots[0].startMinute = 650; }],
  ['duplicate snapshot slot', r => r.snapshot.slots.push(r.snapshot.slots[0])],
  ['orphan snapshot slot', r => { r.snapshot.slots[0].itemId = 'missing'; }],
  ['incomplete capacity', r => { r.snapshot.capacity.slotCount = 1; }],
]) test(`batch rejects ${name} rather than confirming a partial receipt`, () => {
  const { command, result } = fixture(); mutate(result);
  assert.throws(() => requireTimetableBatchResult(result, command), /timetable_plan_response_invalid/);
});

test('old SQL rejecting the new operation keeps failure and makes no scalar fallback', async () => {
  const { command } = fixture(), calls = [];
  const rejection = { code: '22023', message: 'timetable_invalid' };
  const service = createTimetablePlanService({ actorScope: 'admin', client: withRpcQueryControls({ rpc(name, args) { calls.push({ name, args }); return Promise.resolve({ data: null, error: rejection }); } }) });
  await assert.rejects(service.saveBatch(command), error => error === rejection);
  assert.equal(calls.length, 1); assert.equal(calls[0].args.p_command.operation, 'save_batch');
});

test('batch replay validates its immutable commit snapshot independently of later reads', () => {
  const { command, result } = fixture();
  assert.equal(requireTimetableBatchResult(result, command).committedChangeSequence, 9);
  assert.equal(command.expectedChangeSequence, 8);
});

test('canonical PostgreSQL jsonb key order preserves non-empty pending slot data', () => {
  const { command, result } = fixture();
  const pending = { id: 'pending', sourceText: '월 10시', reason: 'missing_resource', weekday: 1, startMinute: 600, endMinute: 660, teacherId: null, classroomId: null };
  command.edits[0].item.pendingSlots = [pending];
  result.snapshot.items[0].pendingSlots = [Object.fromEntries(Object.entries(pending).reverse())];
  assert.equal(requireTimetableBatchResult(result, command).snapshot.items[0].pendingSlots[0].sourceText, '월 10시');
  result.snapshot.items[0].pendingSlots[0].startMinute = 650;
  assert.throws(() => requireTimetableBatchResult(result, command), /timetable_plan_response_invalid/);
});

test('batch transport keeps abort signal and disables hidden request retries', async () => {
  const { command, result } = fixture(), calls = [], controller = new AbortController();
  const client = { rpc(name, args) {
    const call = { name, args }; calls.push(call);
    return { abortSignal(signal) { call.signal = signal; return this; }, retry(enabled) { call.retry = enabled; return this; }, then(resolve, reject) { return Promise.resolve({ data: result, error: null }).then(resolve, reject); } };
  } };
  const service = createTimetablePlanService({ actorScope: 'admin', client });
  await service.saveBatch(command, { signal: controller.signal });
  assert.equal(calls.length, 1); assert.equal(calls[0].retry, false);
  assert.ok(calls[0].signal instanceof AbortSignal); controller.abort(); assert.equal(calls[0].signal.aborted, true);
});

test('real placement form negative zero retains acknowledgement after JSON wire normalization', async () => {
  const { command, result } = fixture();
  const placementDraft = { item: command.edits[0].item, slots: command.edits[0].slots };
  const edit = buildPlacementFormEdit(placementDraft, { ...placementFormDefaults(placementDraft), capacity: '-0', tuition: '-0' });
  assert.ok(Object.is(edit.item.capacity, -0));
  command.edits[0] = { ...edit, expectedItemRevision: 1 };
  result.snapshot.items[0] = { ...result.snapshot.items[0], ...edit.item, capacity: 0, tuition: 0 };
  const calls = [];
  const service = createTimetablePlanService({ actorScope: 'admin', client: withRpcQueryControls({ rpc(name, args) { calls.push({ name, args: JSON.parse(JSON.stringify(args)) }); return Promise.resolve({ data: JSON.parse(JSON.stringify(result)), error: null }); } }) });
  assert.equal((await service.saveBatch(command)).snapshot.items[0].capacity, 0);
  assert.equal(calls.length, 1); assert.equal(calls[0].args.p_command.edits[0].item.capacity, 0);
});

test('batch preserves scoped partial occupancy and immutable applied snapshots', () => {
  const { command, result } = fixture();
  const applied = { ...item('applied', 4), state: 'applied', appliedClassId: null, appliedTransferId: 'transfer', appliedAt: '2026-10-12T12:00:00Z' };
  result.snapshot.items.push(applied);
  result.snapshot.appliedSnapshots = [{ itemId: applied.id, slots: [slot('applied-slot', applied.id, 780)] }];
  result.snapshot.capacity = { ...result.snapshot.capacity, itemCount: 3, slotCount: 3 };
  result.snapshot.occupancyValidationVersion = 2;
  result.snapshot.complete = false; result.snapshot.datedComplete = false;
  result.snapshot.unresolvedOccupancies = [{ classId: 'partial', label: '다른 요일 수업', scope: 'all', resourceId: null, reason: 'unresolved_time', weekday: 3, startMinute: null, endMinute: 780, teacherId: null, classroomId: null }];
  assert.equal(requireTimetableBatchResult(result, command).snapshot.appliedSnapshots[0].slots.length, 1);
});

for (const [name, change] of [
  ['slot UUID case', c => { c.edits[0].slots[0].id = 'ABCDEF00-0000-4000-8000-000000000001'; }],
  ['item UUID case', c => { c.edits[0].item.id = 'ABCDEF00-0000-4000-8000-000000000002'; }],
  ['resource UUID spelling', c => { c.edits[0].slots[0].teacherId = '{abcdef00-0000-4000-8000-000000000003}'; }],
]) test(`batch rejects noncanonical ${name} before an irreversible RPC`, async () => {
  const { command, result } = fixture(), calls = []; change(command);
  const original = structuredClone(command);
  const service = createTimetablePlanService({ actorScope: 'admin', client: withRpcQueryControls({ rpc(name, args) { calls.push({ name, args }); return Promise.resolve({ data: result, error: null }); } }) });
  await assert.rejects(service.saveBatch(command), error => error.code === '22023' && error.message === 'timetable_invalid');
  assert.equal(calls.length, 0); assert.deepEqual(command, original);
});
