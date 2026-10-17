import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTimetablePlanController, type TimetableItemEdit } from '../src/features/academic/timetable-plan-model.ts';
import type { BatchPlanItemsCommand, BatchSaveResult, DeletePlanItemCommand, PlanItem, PlanMutationResult, PlanRevision, PlanSnapshot, PlanSlot, SavePlanItemCommand } from '../src/features/academic/timetable-plan-contract.ts';

function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const item = (id = 'a'): PlanItem => ({ id, planId: 'plan', revision: 1, name: id, subject: '영어', subjectAreaKey: null, grade: '중1', capacity: null, tuition: null, defaultTeacherId: null, defaultClassroomId: null, durationMinutes: null, sourceClassId: null, state: 'draft', appliedClassId: null, appliedTransferId: null, appliedAt: null, pendingSlots: [] });
const slot = (id = 'a', startMinute = 600): PlanSlot => ({ id: `${id}-slot`, itemId: id, planId: 'plan', weekday: id === 'a' ? 1 : 2, startMinute, endMinute: startMinute + 50, teacherId: 'teacher', classroomId: 'room', sourceSlotId: null });
const edit = (id = 'a', startMinute = 610): TimetableItemEdit => ({ operation: 'save', item: item(id), slots: [slot(id, startMinute)] });
function snapshot(): PlanSnapshot { return { plan: { id: 'plan', name: '합성 프리셋', state: 'draft', metaRevision: 1, changeSequence: 1, targetStartDate: null, targetEndDate: null }, items: [item('a'), item('b'), item('c')], slots: [slot('a'), slot('b'), slot('c', 800)], appliedSnapshots: [], members: [], permissions: { canManage: true, canEdit: true, canTransfer: true }, capacity: { itemCount: 3, slotCount: 3, maxItems: 500, maxSlots: 2000, exceeded: false }, occupancyValidationVersion: 2, asOfDate: '2026-10-13', shadowSlots: [], shadowClasses: [], catalogs: { teachers: [], classrooms: [] }, unresolvedOccupancies: [], shadowFingerprint: 'weekly', datedSessions: [], datedUnresolvedOccupancies: [], datedFingerprint: 'dated', datedComplete: true, complete: true }; }
function storage() { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); }, values }; }
function harness(store = storage()) {
  const singles: Array<SavePlanItemCommand | DeletePlanItemCommand> = [], singleReplies: ReturnType<typeof deferred<PlanMutationResult>>[] = [];
  const batches: BatchPlanItemsCommand[] = [], replies: ReturnType<typeof deferred<BatchSaveResult>>[] = [];
  let server = snapshot(), reads = 0, revisionReads = 0;
  let heldRead: ReturnType<typeof deferred<PlanSnapshot>> | null = null;
  const service = {
    readPlan: async () => { reads++; return heldRead ? heldRead.promise : structuredClone(server); },
    readRevision: async (): Promise<PlanRevision> => { revisionReads++; return { planId: 'plan', metaRevision: server.plan.metaRevision, changeSequence: server.plan.changeSequence, shadowFingerprint: server.shadowFingerprint, complete: server.complete }; },
    saveItem: (command: SavePlanItemCommand | DeletePlanItemCommand) => { singles.push(structuredClone(command)); const reply = deferred<PlanMutationResult>(); singleReplies.push(reply); return reply.promise; },
    saveBatch: (command: BatchPlanItemsCommand) => { batches.push(structuredClone(command)); const reply = deferred<BatchSaveResult>(); replies.push(reply); return reply.promise; },
  };
  const make = () => createTimetablePlanController({ service, actorScope: 'actor', planId: 'plan', storage: store, autoSave: false });
  const succeed = (index: number) => {
    const command = batches[index], next = structuredClone(server);
    const acknowledgements: BatchSaveResult['acknowledgements'] = [];
    for (const row of command.edits) {
      const id = row.operation === 'save' ? row.item.id : row.itemId, previous = server.items.find(value => value.id === id);
      const revision = row.operation === 'save' ? (previous?.revision ?? 0) + 1 : null;
      next.items = next.items.filter(value => value.id !== id); next.slots = next.slots.filter(value => value.itemId !== id);
      if (row.operation === 'save') { next.items.push({ ...item(id), ...row.item, revision: revision! }); next.slots.push(...row.slots); }
      acknowledgements.push({ itemId: id, operation: row.operation, itemRevision: revision });
    }
    next.plan.changeSequence++; next.capacity.itemCount = next.items.length; next.capacity.slotCount = next.slots.length; server = next;
    const result: BatchSaveResult = { planId: 'plan', requestKey: command.requestKey, committedMetaRevision: next.plan.metaRevision, committedChangeSequence: next.plan.changeSequence, acknowledgements, snapshot: structuredClone(next) };
    replies[index].resolve(result); return result;
  };
  return { make, service, singles, singleReplies, batches, replies, succeed, store, server: () => server, setServer: (value: PlanSnapshot) => { server = value; }, counts: () => ({ reads, revisionReads }), holdRead: () => { heldRead = deferred<PlanSnapshot>(); return heldRead; }, releaseRead: () => { heldRead = null; } };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
type Controller = ReturnType<typeof createTimetablePlanController>;
async function stage(c: Controller, h: ReturnType<typeof harness>, value: TimetableItemEdit, revision?: number | null) { const singles = h.singles.length, batches = h.batches.length; await c.dispatch(value, revision); assert.equal(h.singles.length, singles); assert.equal(h.batches.length, batches); }
function legacyRecovery(h: ReturnType<typeof harness>, guards: Array<number | null | undefined> = [undefined]) {
  const original: SavePlanItemCommand = { operation: 'save', planId: 'plan', expectedMetaRevision: 1, expectedShadowFingerprint: 'weekly', expectedItemRevision: 1, requestKey: 'legacy-original', item: item('a'), slots: [slot('a', 610)] };
  h.store.values.set('tips:timetable:draft:v1:actor:plan', JSON.stringify({ version: 1, entries: [{ edit: edit('a', 610), submitted: original, status: 'error', expectedItemRevision: 1 }, ...guards.map((guard, index) => ({ edit: edit('a', 620 + index * 10), submitted: null, status: 'queued', expectedItemRevision: guard }))] })); return original;
}
function confirmLegacy(h: ReturnType<typeof harness>, index = 0) { const next = h.server(); next.items[0].revision = 2; next.slots[0] = slot('a', 610); next.plan.changeSequence = 2; h.setServer(next); h.singleReplies[index].resolve({ planId: 'plan', metaRevision: 1, changeSequence: 2, shadowFingerprint: 'weekly', item: { ...item('a'), revision: 2 }, slots: [slot('a', 610)], removedItemIds: [] }); }

test('repeated local moves, undo, cancel and returning to baseline make zero writes or reads', async () => { const h = harness(), c = h.make(); await c.load(); for (const minute of [610, 620, 630]) await stage(c, h, edit('a', minute)); assert.equal(c.snapshot().saveState, 'draft'); assert.equal(c.snapshot().pendingOperations.length, 1); await c.undo(); assert.equal(c.snapshot().draft?.slots.find(row => row.itemId === 'a')?.startMinute, 620); await stage(c, h, edit('a', 600)); assert.equal(c.snapshot().dirty, false); await stage(c, h, { operation: 'delete', itemId: 'a' }); await c.discardDraft(); assert.equal(c.snapshot().dirty, false); assert.deepEqual(h.counts(), { reads: 1, revisionReads: 0 }); c.destroy(); });

test('all final edits use exactly one frozen batch and duplicate Save shares the flight', async () => { const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 610)); await stage(c, h, edit('a', 630)); await stage(c, h, edit('b', 700)); const saving = c.saveDraft(); assert.equal(c.saveDraft(), saving); await tick(); assert.equal(h.batches.length, 1); assert.equal(h.singles.length, 0); const command = h.batches[0]; assert.equal(command.operation, 'save_batch'); assert.equal(command.expectedChangeSequence, 1); assert.equal(command.edits.length, 2); assert.equal(command.edits[0].expectedItemRevision, 1); if (command.edits[0].operation === 'save') assert.equal(command.edits[0].slots[0].startMinute, 630); await assert.rejects(c.dispatch(edit('c', 900)), /timetable_save_in_progress/); await assert.rejects(c.discardDraft(), /timetable_save_in_progress/); h.succeed(0); await saving; assert.equal(c.snapshot().dirty, false); c.destroy(); });

test('two-item time and resource swaps commit together as the final candidate', async () => { const h = harness(), c = h.make(), original = h.server(); original.items = [item('a'), item('b')]; original.slots = [slot('a', 600), { ...slot('b', 700), weekday: 1, classroomId: 'other-room' }]; original.capacity.itemCount = 2; original.capacity.slotCount = 2; h.setServer(original); await c.load(); await stage(c, h, { operation: 'save', item: item('b'), slots: [{ ...slot('b', 900), weekday: 1 }] }); await stage(c, h, { operation: 'save', item: item('a'), slots: [{ ...slot('a', 700), classroomId: 'other-room' }] }); await stage(c, h, { operation: 'save', item: item('b'), slots: [{ ...slot('b', 600), weekday: 1 }] }); assert.deepEqual(c.snapshot().conflicts, []); const saving = c.saveDraft(); await tick(); assert.equal(h.batches.length, 1); assert.equal(h.batches[0].edits.length, 2); h.succeed(0); await saving; assert.equal(c.snapshot().snapshot?.slots.find(row => row.itemId === 'a')?.startMinute, 700); assert.equal(c.snapshot().snapshot?.slots.find(row => row.itemId === 'b')?.startMinute, 600); assert.equal(c.snapshot().dirty, false); c.destroy(); });

test('batch rejection changes no saved item and retains saves plus deletes as one local candidate', async () => { const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 630)); await stage(c, h, { operation: 'delete', itemId: 'b' }); const saving = c.saveDraft(), rejected = assert.rejects(saving); await tick(); h.replies[0].reject({ code: '23P01', message: 'timetable_resource_conflict' }); await rejected; assert.equal(c.snapshot().snapshot?.slots.find(row => row.itemId === 'a')?.startMinute, 600); assert.equal(c.snapshot().snapshot?.items.some(row => row.id === 'b'), true); assert.equal(c.snapshot().draft?.slots.find(row => row.itemId === 'a')?.startMinute, 630); assert.equal(c.snapshot().draft?.items.some(row => row.id === 'b'), false); assert.equal(c.failureKind('a'), 'rejected'); assert.equal(c.snapshot().canDiscardDraft, true); await c.discardDraft(); assert.equal(c.snapshot().dirty, false); c.destroy(); });

test('uncertain batch survives reload and retries the identical whole body while edits and cancellation remain blocked', async () => { const h = harness(); let c = h.make(); await c.load(); await stage(c, h, edit('a', 630)); await stage(c, h, { operation: 'delete', itemId: 'b' }); const saving = c.saveDraft(), rejected = assert.rejects(saving); await tick(); const original = structuredClone(h.batches[0]); h.replies[0].reject(Error('response lost')); await rejected; c.destroy(); c = h.make(); await c.load(); assert.equal(h.batches.length, 1); assert.equal(c.failureKind('a'), 'uncertain'); await assert.rejects(c.dispatch(edit('c', 900)), /timetable_failed_edit_pending/); await assert.rejects(c.discardDraft(), /timetable_submitted_request_pending/); const retry = c.retry('a'); await tick(); assert.deepEqual(h.batches[1], original); h.succeed(1); await retry; assert.equal(c.snapshot().dirty, false); c.destroy(); });

test('already committed batch acknowledgement clears local intent without downgrading a newer authorized read', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 630));
  const saving = c.saveDraft(), rejected = assert.rejects(saving); await tick(); const command = h.batches[0];
  const commit = structuredClone(h.server()); commit.plan.changeSequence = 2; commit.items[0].revision = 2; commit.slots[0] = slot('a', 630);
  h.replies[0].reject(Error('response lost')); await rejected;
  const newer = structuredClone(commit); newer.plan.changeSequence = 9; newer.items[0].revision = 9; newer.slots[0] = slot('a', 900);
  h.setServer(newer); await c.refresh(); const retry = c.retry(); await tick();
  h.replies[1].resolve({ planId: 'plan', requestKey: command.requestKey, committedMetaRevision: 1, committedChangeSequence: 2,
    acknowledgements: [{ itemId: 'a', operation: 'save', itemRevision: 2 }], snapshot: commit });
  await retry; assert.equal(c.snapshot().snapshot?.plan.changeSequence, 9);
  assert.equal(c.snapshot().snapshot?.slots.find(row => row.itemId === 'a')?.startMinute, 900); assert.equal(c.snapshot().dirty, false); c.destroy();
});

test('confirmed stale batch can explicitly reapply locally and build a fresh versioned batch', async () => { const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 630)); const saving = c.saveDraft(), rejected = assert.rejects(saving); await tick(); h.replies[0].reject({ code: 'P0001', message: 'timetable_stale' }); await rejected; const changed = h.server(); changed.plan.changeSequence = 3; changed.items[0].revision = 3; changed.slots[0] = slot('a', 700); h.setServer(changed); await c.refresh(); await c.resolveStale('a', 'reapply_draft'); assert.equal(h.batches.length, 1); const next = c.saveDraft(); await tick(); assert.equal(h.batches[1].expectedChangeSequence, 3); assert.equal(h.batches[1].edits[0].expectedItemRevision, 3); assert.notEqual(h.batches[1].requestKey, h.batches[0].requestKey); h.succeed(1); await next; c.destroy(); });

test('conclusive rejection correction remains local until another explicit batch save', async () => { const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 630)); await stage(c, h, edit('b', 700)); const saving = c.saveDraft(), rejected = assert.rejects(saving); await tick(); h.replies[0].reject({ code: '22023', message: 'timetable_invalid' }); await rejected; await c.replaceRejected(edit('a', 650)); assert.equal(h.batches.length, 1); const next = c.saveDraft(); await tick(); assert.equal(h.batches[1].edits.length, 2); assert.notEqual(h.batches[1].requestKey, h.batches[0].requestKey); h.succeed(1); await next; c.destroy(); });

for (const guard of [1, null]) test(`earliest saved revision ${guard} cannot be silently rebased after refresh`, async () => { const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit(guard === null ? 'new' : 'a', 630), guard); const changed = h.server(); if (guard === null) changed.items.push(item('new')); else changed.items[0].revision = 2; changed.plan.changeSequence++; h.setServer(changed); await c.refresh(); await assert.rejects(c.saveDraft(), /timetable_stale/); assert.equal(h.batches.length, 0); assert.equal(c.snapshot().dirty, true); await c.discardDraft(); c.destroy(); });

test('legacy immutable head replays singly then only the latest unsent tail enters a batch', async () => { const h = harness(), original = legacyRecovery(h, [undefined, undefined]), c = h.make(); await c.load(); const saving = c.saveDraft(); await tick(); assert.deepEqual(h.singles[0], original); assert.equal(h.batches.length, 0); confirmLegacy(h); await tick(); assert.equal(h.batches.length, 1); assert.equal(h.batches[0].edits.length, 1); if (h.batches[0].edits[0].operation === 'save') assert.equal(h.batches[0].edits[0].slots[0].startMinute, 630); assert.equal(h.batches[0].edits[0].expectedItemRevision, 2); h.succeed(0); await saving; assert.equal(c.snapshot().dirty, false); c.destroy(); });

for (const guard of [1, null]) test(`middle explicit legacy guard ${guard} survives unsent collapse`, async () => { const h = harness(), original = legacyRecovery(h, [undefined, guard, undefined]), c = h.make(); await c.load(); const saving = c.saveDraft(); void saving.catch(() => {}); await tick(); assert.deepEqual(h.singles[0], original); confirmLegacy(h); await tick(); await assert.rejects(saving, /timetable_stale/); assert.equal(h.batches.length, 0); assert.equal(c.snapshot().draft?.slots.find(row => row.itemId === 'a')?.startMinute, 640); c.destroy(); });

test('legacy receipt-only retry never sends later local intent until top Save', async () => { const h = harness(), original = legacyRecovery(h), c = h.make(); await c.load(); const retry = c.retry('a'); await tick(); assert.deepEqual(h.singles[0], original); confirmLegacy(h); await retry; assert.equal(h.batches.length, 0); const saving = c.saveDraft(); await tick(); h.succeed(0); await saving; c.destroy(); });

for (const moment of ['before-microtask', 'submitted-publication', 'in-flight']) test(`logout ${moment} blocks later batch effects and settles Save`, async () => { const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 630)); let stop = () => {}; if (moment === 'submitted-publication') stop = c.subscribe(() => { const stored = JSON.parse([...h.store.values.values()][0] ?? '{}'); if (stored.batch) c.clearSensitive(); }); const saving = c.saveDraft(); const rejected = assert.rejects(saving, /timetable_plan_inactive/); if (moment === 'before-microtask') c.clearSensitive(); if (moment === 'in-flight') { await tick(); c.clearSensitive(); } await rejected; if (h.batches.length) { h.succeed(0); await tick(); } assert.equal(h.batches.length, moment === 'in-flight' ? 1 : 0); assert.equal(c.snapshot().snapshot, null); assert.equal(h.store.values.size, 0); stop(); c.destroy(); });

test('pause retains uncertain batch identity and late responses cannot complete retired Save', async () => { const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 630)); const saving = c.saveDraft(), rejected = assert.rejects(saving, /timetable_plan_inactive/); await tick(); const original = structuredClone(h.batches[0]); c.pause(); await rejected; assert.equal(h.store.values.size, 1); c.resume(); const retry = c.retry(); await tick(); assert.deepEqual(h.batches[1], original); h.succeed(1); await retry; c.destroy(); });

test('manual concurrent reads coalesce and invalidation during Save causes one final read', async () => { const h = harness(), c = h.make(); await c.load(); const held = h.holdRead(), first = c.refresh(), second = c.refresh(), poll = c.checkRevision(); await tick(); assert.deepEqual(h.counts(), { reads: 2, revisionReads: 0 }); held.resolve(h.server()); h.releaseRead(); await Promise.all([first, second, poll]); await stage(c, h, edit('a', 630)); const saving = c.saveDraft(); await tick(); const before = h.counts(); await Promise.all([c.refresh(), c.checkRevision(), c.refresh()]); assert.deepEqual(h.counts(), before); h.succeed(0); await saving; await tick(); assert.equal(h.counts().reads, before.reads + 1); c.destroy(); });

test('missing batch capability keeps unsent drafts and never falls back to item writes', async () => { const h = harness(), c = createTimetablePlanController({ service: { readPlan: h.service.readPlan, readRevision: h.service.readRevision, saveItem: h.service.saveItem }, actorScope: 'actor', planId: 'plan', storage: h.store, autoSave: false }); await c.load(); await stage(c, h, edit('a', 630)); await assert.rejects(c.saveDraft(), /timetable_batch_rpc_unavailable/); assert.equal(h.singles.length, 0); assert.equal(c.snapshot().dirty, true); assert.equal(c.snapshot().canDiscardDraft, true); c.destroy(); });

test('missing SQL batch function preserves the draft without sequential fallback', async () => { const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 630)); const saving = c.saveDraft(), rejected = assert.rejects(saving); await tick(); h.replies[0].reject({ code: 'PGRST202', message: 'function unavailable' }); await rejected; assert.equal(h.singles.length, 0); assert.equal(c.snapshot().dirty, true); assert.equal(c.snapshot().canDiscardDraft, true); await c.discardDraft(); c.destroy(); });


test('unsent reload preserves local intent without writes and keeps a later collaborator revision stale', async () => {
  const h = harness(); let c = h.make(); await c.load(); await stage(c, h, edit('a', 630)); c.destroy();
  const changed = h.server(); changed.items[0].revision = 3; changed.plan.changeSequence = 3; changed.slots[0] = slot('a', 700); h.setServer(changed);
  c = h.make(); await c.load(); assert.equal(h.batches.length, 0); assert.equal(c.failureKind('a'), 'stale');
  assert.equal(c.snapshot().draft?.slots.find(row => row.itemId === 'a')?.startMinute, 630);
  await assert.rejects(c.saveDraft(), /timetable_stale/); assert.equal(c.snapshot().pendingOperations[0].discardable, true); c.destroy();
});

test('moving to the old baseline after a collaborator change preserves the local intent and stale guard', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 630));
  const changed = h.server(); changed.items[0].revision = 3; changed.plan.changeSequence = 3; changed.slots[0] = slot('a', 700); h.setServer(changed); await c.refresh();
  await stage(c, h, edit('a', 600)); assert.equal(c.snapshot().dirty, true); assert.equal(c.failureKind('a'), 'stale');
  await assert.rejects(c.saveDraft(), /timetable_stale/); assert.equal(h.batches.length, 0); c.destroy();
});

test('local undo retains stale intent discovered by a newer authorized read', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 620)); await stage(c, h, edit('a', 630));
  const changed = h.server(); changed.items[0].revision = 3; changed.plan.changeSequence = 3; h.setServer(changed); await c.refresh(); await c.undo();
  assert.equal(c.snapshot().draft?.slots.find(row => row.itemId === 'a')?.startMinute, 620); assert.equal(c.failureKind('a'), 'stale');
  await assert.rejects(c.saveDraft(), /timetable_stale/); assert.equal(h.batches.length, 0); c.destroy();
});

test('create then delete cancels locally and saved receipt undo stages without a network request', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('new', 630), null); await stage(c, h, { operation: 'delete', itemId: 'new' });
  assert.equal(c.snapshot().dirty, false); await c.saveDraft(); assert.equal(h.batches.length, 0);
  await stage(c, h, edit('a', 630)); const saving = c.saveDraft(); await tick(); h.succeed(0); await saving; await c.undo();
  assert.equal(c.snapshot().draft?.slots.find(row => row.itemId === 'a')?.startMinute, 600); assert.equal(h.batches.length, 1); assert.equal(h.singles.length, 0); c.destroy();
});

test('preflight save failure preserves local undo history', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 620)); await stage(c, h, edit('a', 630));
  const original = h.service.readPlan; h.service.readPlan = async () => { throw Error('reference unavailable'); }; await c.refresh();
  await assert.rejects(c.saveDraft(), /timetable_reference_unverifiable/); assert.equal(h.batches.length, 0); assert.equal(c.snapshot().canUndo, true);
  await c.undo(); assert.equal(c.snapshot().draft?.slots.find(row => row.itemId === 'a')?.startMinute, 620); h.service.readPlan = original; c.destroy();
});

test('Save published to a reentrant subscriber already owns the shared flight', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 630)); let reentered: Promise<void> | null = null;
  const stop = c.subscribe(() => { if (c.snapshot().saving && !reentered) reentered = c.saveDraft(); });
  const saving = c.saveDraft(); assert.equal(reentered, saving); await tick(); assert.equal(h.batches.length, 1); h.succeed(0); await saving; stop(); c.destroy();
});

test('poll-first and explicit refresh share one canonical read when revision changed', async () => {
  const h = harness(), c = h.make(); await c.load(); const changed = h.server(); changed.plan.changeSequence = 2; h.setServer(changed);
  await Promise.all([c.checkRevision(), c.refresh(), c.checkRevision()]); assert.deepEqual(h.counts(), { reads: 2, revisionReads: 1 }); c.destroy();
});

test('an invalidation arriving during an older read requires exactly one subsequent read', async () => {
  const h = harness(), c = h.make(); await c.load(); const held = h.holdRead(), initial = c.refresh(); await tick();
  const changed = structuredClone(h.server()); changed.plan.changeSequence = 3; changed.items[0].revision = 3; h.setServer(changed); void c.refresh(); void c.refresh();
  held.resolve(snapshot()); h.releaseRead(); await initial; await tick(); assert.equal(h.counts().reads, 3); assert.equal(c.snapshot().snapshot?.plan.changeSequence, 3); c.destroy();
});

test('old read begun before batch save cannot overwrite its receipt and schedules one final read', async () => {
  const h = harness(), c = h.make(); await c.load(); const held = h.holdRead(), reading = c.refresh(); await tick();
  await stage(c, h, edit('a', 630)); const saving = c.saveDraft(); await tick(); h.succeed(0); held.resolve(snapshot()); h.releaseRead();
  await Promise.all([saving, reading]); await tick(); assert.equal(h.counts().reads, 3); assert.equal(c.snapshot().snapshot?.plan.changeSequence, 2);
  assert.equal(c.snapshot().snapshot?.slots.find(row => row.itemId === 'a')?.startMinute, 630); c.destroy();
});

test('partial or malformed batch receipt retains the complete immutable request for retry', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 630)); await stage(c, h, { operation: 'delete', itemId: 'b' });
  const saving = c.saveDraft(), rejected = assert.rejects(saving, /timetable_plan_response_invalid/); await tick(); const original = structuredClone(h.batches[0]);
  const partial = structuredClone(h.server()); partial.plan.changeSequence = 2;
  h.replies[0].resolve({ planId: 'plan', requestKey: original.requestKey, committedMetaRevision: 1, committedChangeSequence: 2,
    acknowledgements: [{ itemId: 'a', operation: 'save', itemRevision: 2 }], snapshot: partial }); await rejected;
  assert.equal(c.failureKind('b'), 'uncertain'); assert.equal(c.snapshot().canDiscardDraft, false); assert.equal(c.snapshot().pendingOperations.every(row => row.discardable === false), true);
  const retry = c.saveDraft(); await tick(); assert.deepEqual(h.batches[1], original); h.succeed(1); await retry; c.destroy();
});

test('legacy successful receipt with changed operating reference stops before batch and rereads once', async () => {
  const h = harness(); legacyRecovery(h); const c = h.make(); await c.load(); const saving = c.saveDraft(), rejected = assert.rejects(saving, /timetable_reference_unverifiable/); await tick();
  const next = h.server(); next.items[0].revision = 2; next.slots[0] = slot('a', 610); next.plan.changeSequence = 2; next.shadowFingerprint = 'changed'; h.setServer(next);
  h.singleReplies[0].resolve({ planId: 'plan', metaRevision: 1, changeSequence: 2, shadowFingerprint: 'changed', item: next.items[0], slots: [next.slots[0]], removedItemIds: [] });
  await rejected; await tick(); assert.equal(h.batches.length, 0); assert.equal(h.counts().reads, 2); assert.equal(c.snapshot().dirty, true); c.destroy();
});


test('an immutable uncertain batch replays after an authorized archived read while new edits remain forbidden', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 630));
  const saving = c.saveDraft(), rejected = assert.rejects(saving); await tick(); const command = structuredClone(h.batches[0]);
  const commit = structuredClone(h.server()); commit.plan.changeSequence = 2; commit.items[0].revision = 2; commit.slots[0] = slot('a', 630);
  h.replies[0].reject(Error('response lost')); await rejected;
  const archived = structuredClone(commit); archived.plan.state = 'archived'; archived.plan.metaRevision = 2; archived.plan.changeSequence = 3; archived.permissions.canEdit = false;
  h.setServer(archived); await c.refresh(); const retry = c.retry(); await tick(); assert.deepEqual(h.batches[1], command);
  h.replies[1].resolve({ planId: 'plan', requestKey: command.requestKey, committedMetaRevision: 1, committedChangeSequence: 2,
    acknowledgements: [{ itemId: 'a', operation: 'save', itemRevision: 2 }], snapshot: commit }); await retry;
  assert.equal(c.snapshot().snapshot?.plan.state, 'archived'); assert.equal(c.snapshot().dirty, false);
  await assert.rejects(c.dispatch(edit('a', 700)), /timetable_forbidden/); c.destroy();
});

test('equal-sequence newer operating reference is retained when immutable commit snapshot replays', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 630));
  const saving = c.saveDraft(), rejected = assert.rejects(saving); await tick(); const command = h.batches[0];
  const commit = structuredClone(h.server()); commit.plan.changeSequence = 2; commit.items[0].revision = 2; commit.slots[0] = slot('a', 630);
  h.replies[0].reject(Error('response lost')); await rejected; const newer = structuredClone(commit); newer.shadowFingerprint = 'updated-operating-reference';
  h.setServer(newer); await c.refresh(); const retry = c.retry(); await tick();
  h.replies[1].resolve({ planId: 'plan', requestKey: command.requestKey, committedMetaRevision: 1, committedChangeSequence: 2,
    acknowledgements: [{ itemId: 'a', operation: 'save', itemRevision: 2 }], snapshot: commit }); await retry;
  assert.equal(c.snapshot().snapshot?.shadowFingerprint, 'updated-operating-reference'); assert.equal(c.snapshot().dirty, false); c.destroy();
});

test('duplicate retry and top Save share the same immutable batch flight', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 630));
  const saving = c.saveDraft(), rejected = assert.rejects(saving); await tick(); const original = structuredClone(h.batches[0]);
  h.replies[0].reject(Error('response lost')); await rejected; const retry = c.retry('a');
  assert.equal(c.retry(), retry); assert.equal(c.saveDraft(), retry); await tick(); assert.equal(h.batches.length, 2);
  assert.deepEqual(h.batches[1], original); h.succeed(1); await retry; c.destroy();
});

test('a successful multi-item batch does not advertise an unrelated older single-item receipt undo', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 630));
  const first = c.saveDraft(); await tick(); h.succeed(0); await first; assert.equal(c.snapshot().canUndo, true);
  await stage(c, h, edit('a', 650)); await stage(c, h, edit('b', 700)); const next = c.saveDraft(); await tick(); h.succeed(1); await next;
  assert.equal(c.snapshot().canUndo, false); await assert.rejects(c.undo(), /timetable_undo_unavailable/); assert.equal(h.batches.length, 2); c.destroy();
});

test('batch authorization denial clears the actor plan and recovery instead of exposing a retryable draft', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 630));
  const saving = c.saveDraft(), rejected = assert.rejects(saving); await tick(); h.replies[0].reject({ code: '42501', message: 'timetable_forbidden' }); await rejected;
  assert.equal(c.snapshot().snapshot, null); assert.equal(c.snapshot().draft, null); assert.equal(c.snapshot().dirty, false); assert.equal(h.store.values.size, 0); c.destroy();
});

test('pause during submitted publication sends no request and retains its frozen batch for explicit retry', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 630)); let paused = false;
  const stop = c.subscribe(() => { const stored = JSON.parse([...h.store.values.values()][0] ?? '{}'); if (stored.batch && !paused) { paused = true; c.pause(); } });
  const saving = c.saveDraft(); await assert.rejects(saving, /timetable_plan_inactive/); assert.equal(h.batches.length, 0);
  const stored = JSON.parse([...h.store.values.values()][0]); stop(); c.resume(); const retry = c.retry(); await tick(); assert.deepEqual(h.batches[0], stored.batch.command);
  h.succeed(0); await retry; c.destroy();
});
