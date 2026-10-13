import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTimetablePlanController, type TimetableItemEdit } from '../src/features/academic/timetable-plan-model.ts';
import { createClient } from '@supabase/supabase-js';
import { createTimetablePlanService } from '../src/features/academic/timetable-plan-service.ts';
import type { DeletePlanItemCommand, PlanItem, PlanMutationResult, PlanRevision, PlanSnapshot, PlanSlot, SavePlanItemCommand } from '../src/features/academic/timetable-plan-contract.ts';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const item = (id = 'a'): PlanItem => ({ id, planId: 'plan', revision: 1, name: id, subject: '영어', subjectAreaKey: null,
  grade: '중1', capacity: null, tuition: null, defaultTeacherId: null, defaultClassroomId: null, durationMinutes: null,
  sourceClassId: null, state: 'draft', appliedClassId: null, appliedTransferId: null, appliedAt: null, pendingSlots: [] });
const slot = (id = 'a', startMinute = 600): PlanSlot => ({ id: `${id}-slot`, itemId: id, planId: 'plan', weekday: id === 'a' ? 1 : 2,
  startMinute, endMinute: startMinute + 50, teacherId: 'teacher', classroomId: 'room', sourceSlotId: null });
const edit = (id = 'a', startMinute = 610): TimetableItemEdit => ({ operation: 'save', item: item(id), slots: [slot(id, startMinute)] });
function snapshot(): PlanSnapshot {
  return { plan: { id: 'plan', name: '합성 프리셋', state: 'draft', metaRevision: 1, changeSequence: 1, targetStartDate: null, targetEndDate: null },
    items: [item('a'), item('b'), item('c')], slots: [slot('a'), slot('b'), slot('c', 800)], appliedSnapshots: [], members: [],
    permissions: { canManage: true, canEdit: true, canTransfer: true }, capacity: { itemCount: 3, slotCount: 3, maxItems: 500, maxSlots: 2000, exceeded: false },
    occupancyValidationVersion: 2, asOfDate: '2026-10-13', shadowSlots: [], shadowClasses: [], catalogs: { teachers: [], classrooms: [] },
    unresolvedOccupancies: [], shadowFingerprint: 'weekly', datedSessions: [], datedUnresolvedOccupancies: [], datedFingerprint: 'dated', datedComplete: true, complete: true };
}
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, values };
}
function harness(store = storage()) {
  const calls: Array<SavePlanItemCommand | DeletePlanItemCommand> = [], replies: ReturnType<typeof deferred<PlanMutationResult>>[] = [];
  let server = snapshot(), reads = 0, revisionReads = 0;
  let readReply: ReturnType<typeof deferred<PlanSnapshot>> | null = null;
  let revisionReply: ReturnType<typeof deferred<PlanRevision>> | null = null;
  const service = {
    readPlan: async () => { reads++; return readReply ? readReply.promise : structuredClone(server); },
    readRevision: async () => { revisionReads++; return revisionReply ? revisionReply.promise : { planId: 'plan', metaRevision: server.plan.metaRevision,
      changeSequence: server.plan.changeSequence, shadowFingerprint: server.shadowFingerprint, complete: server.complete }; },
    saveItem: (command: SavePlanItemCommand | DeletePlanItemCommand) => { calls.push(structuredClone(command)); const reply = deferred<PlanMutationResult>(); replies.push(reply); return reply.promise; },
  };
  const make = () => createTimetablePlanController({ service, actorScope: 'actor', planId: 'plan', storage: store, autoSave: false });
  const succeed = (index: number) => {
    const command = calls[index], id = command.operation === 'save' ? command.item.id : command.itemId;
    const saved = command.operation === 'save' ? { ...item(id), ...command.item, revision: (server.items.find(row => row.id === id)?.revision ?? 0) + 1 } : null;
    server = { ...server, plan: { ...server.plan, changeSequence: server.plan.changeSequence + 1 },
      items: [...server.items.filter(row => row.id !== id), ...(saved ? [saved] : [])],
      slots: [...server.slots.filter(row => row.itemId !== id), ...(command.operation === 'save' ? command.slots : [])] };
    replies[index].resolve({ planId: 'plan', metaRevision: server.plan.metaRevision, changeSequence: server.plan.changeSequence,
      shadowFingerprint: server.shadowFingerprint, item: saved, slots: command.operation === 'save' ? command.slots : [], removedItemIds: saved ? [] : [id] });
  };
  return { make, service, calls, replies, succeed, store, server: () => server, setServer: (value: PlanSnapshot) => { server = value; },
    counts: () => ({ reads, revisionReads }), holdRead: () => { readReply = deferred<PlanSnapshot>(); return readReply; }, releaseRead: () => { readReply = null; },
    holdRevision: () => { revisionReply = deferred<PlanRevision>(); return revisionReply; }, releaseRevision: () => { revisionReply = null; } };
}
type Controller = ReturnType<typeof createTimetablePlanController>;
async function stage(controller: Controller, h: ReturnType<typeof harness>, value: TimetableItemEdit, revision?: number | null) {
  const before = h.calls.length;
  const staged = controller.dispatch(value, revision);
  void staged.catch(() => {});
  assert.equal(h.calls.length, before, 'manual dispatch must not send a server request');
  await staged;
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('repeated manual moves coalesce locally and returning to saved coordinates removes pending intent', async () => {
  const h = harness(), c = h.make(); await c.load();
  for (const minute of [610, 620, 630]) await stage(c, h, edit('a', minute));
  assert.equal(c.snapshot().draft?.slots.find(row => row.itemId === 'a')?.startMinute, 630);
  assert.equal(c.snapshot().pendingOperations.length, 1); assert.equal(c.snapshot().saveState, 'draft');
  assert.equal(c.snapshot().dirty, true); assert.equal(c.snapshot().canDiscardDraft, true);
  await stage(c, h, edit('a', 600));
  assert.equal(c.snapshot().dirty, false); assert.equal(c.snapshot().pendingOperations.length, 0);
  assert.deepEqual(h.counts(), { reads: 1, revisionReads: 0 }); c.destroy();
});

test('one explicit save sends only the final item edit and duplicate clicks share the same flight', async () => {
  const h = harness(), c = h.make(); await c.load();
  await stage(c, h, edit('a', 610)); await stage(c, h, edit('a', 625));
  const saving = c.saveDraft(); assert.equal(c.saveDraft(), saving);
  await tick(); assert.equal(h.calls.length, 1); assert.equal(c.snapshot().saving, true);
  await assert.rejects(c.dispatch(edit('b', 700)), /timetable_save_in_progress/);
  await assert.rejects(c.discardDraft(), /timetable_save_in_progress/);
  const command = h.calls[0]; assert.equal(command.operation, 'save');
  if (command.operation === 'save') { assert.equal(command.slots[0].startMinute, 625); assert.equal(command.expectedItemRevision, 1); }
  h.succeed(0); await saving;
  assert.equal(c.snapshot().dirty, false); assert.equal(c.snapshot().saving, false); c.destroy();
});

test('explicit Save stops on a failed item and cancellation removes only later unsent drafts', async () => {
  const h = harness(), c = h.make(); await c.load();
  await stage(c, h, edit('a', 610)); await stage(c, h, edit('b', 700)); await stage(c, h, edit('c', 900));
  const saving = c.saveDraft(); const rejected = assert.rejects(saving, /response lost/); await tick();
  h.succeed(0); await tick(); assert.equal(h.calls.length, 2);
  h.replies[1].reject(Error('response lost')); await rejected;
  assert.equal(h.calls.length, 2); assert.equal(c.snapshot().snapshot?.slots.find(row => row.itemId === 'a')?.startMinute, 610);
  assert.equal(c.failureKind('b'), 'uncertain'); assert.equal(c.snapshot().canDiscardDraft, true);
  assert.equal(c.snapshot().pendingOperations.find(row => row.itemId === 'b')?.discardable, false);
  assert.equal(c.snapshot().pendingOperations.find(row => row.itemId === 'c')?.discardable, true);
  await c.discardDraft();
  assert.deepEqual(c.snapshot().pendingOperations.map(row => row.itemId), ['b']);
  assert.equal(c.snapshot().draft?.slots.find(row => row.itemId === 'c')?.startMinute, 800);
  await assert.rejects(c.discardDraft(), /timetable_submitted_request_pending/); c.destroy();
});

test('unsent drafts survive reload without saving and keep the original revision when collaborators change them', async () => {
  const h = harness(); let c = h.make(); await c.load(); await stage(c, h, edit('a', 630)); c.destroy();
  const changed = h.server(); changed.items[0].revision = 2; changed.slots[0].startMinute = 660; changed.slots[0].endMinute = 710; changed.plan.changeSequence++;
  h.setServer(changed); c = h.make(); await c.load();
  assert.equal(h.calls.length, 0); assert.equal(c.failureKind('a'), 'stale');
  assert.equal(c.snapshot().draft?.slots.find(row => row.itemId === 'a')?.startMinute, 630);
  await assert.rejects(c.saveDraft(), /timetable_stale/);
  await c.resolveStale('a', 'reapply_draft'); assert.equal(h.calls.length, 0);
  const saving = c.saveDraft(); await tick(); assert.equal(h.calls[0].expectedItemRevision, 2); h.succeed(0); await saving; c.destroy();
});

test('manual create baseline null cannot silently rebase to a collaborator-created item', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('new', 700), null);
  const changed = h.server(); changed.items.push(item('new')); changed.slots.push(slot('new', 800)); changed.plan.changeSequence++;
  h.setServer(changed); await c.refresh();
  assert.equal(c.failureKind('new'), 'stale'); await assert.rejects(c.saveDraft(), /timetable_stale/);
  assert.equal(h.calls.length, 0); c.destroy();
});

test('uncertain submitted save survives reload and only explicit retry reuses its exact body', async () => {
  const h = harness(); let c = h.make(); await c.load(); await stage(c, h, edit('a', 630));
  const saving = c.saveDraft(); const rejected = assert.rejects(saving, /response lost/); await tick();
  const original = structuredClone(h.calls[0]); h.replies[0].reject(Error('response lost')); await rejected; c.destroy();
  c = h.make(); await c.load(); assert.equal(h.calls.length, 1);
  await assert.rejects(c.dispatch(edit('a', 640)), /timetable_failed_edit_pending/);
  await assert.rejects(c.discardDraft(), /timetable_submitted_request_pending/);
  const retry = c.retry('a'); await tick(); assert.deepEqual(h.calls[1], original); h.succeed(1); await retry;
  assert.equal(c.snapshot().dirty, false); c.destroy();
});

test('confirmed rejection correction stays local until another explicit save', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 610));
  const saving = c.saveDraft(); const rejected = assert.rejects(saving); await tick();
  h.replies[0].reject({ code: '23P01', message: 'timetable_resource_conflict' }); await rejected;
  await c.replaceRejected(edit('a', 650)); assert.equal(h.calls.length, 1); assert.equal(c.snapshot().saveState, 'draft');
  const corrected = c.saveDraft(); await tick(); assert.notEqual(h.calls[1].requestKey, h.calls[0].requestKey); h.succeed(1); await corrected; c.destroy();
});

test('local undo and cancellation never save or read', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 610)); await stage(c, h, edit('a', 630));
  assert.equal(c.snapshot().canUndo, true); await c.undo(); assert.equal(c.snapshot().draft?.slots.find(row => row.itemId === 'a')?.startMinute, 610);
  await c.undo(); assert.equal(c.snapshot().dirty, false);
  await stage(c, h, { operation: 'delete', itemId: 'a' }); assert.equal(c.snapshot().draft?.items.some(row => row.id === 'a'), false);
  await c.discardDraft(); assert.equal(c.snapshot().draft?.items.some(row => row.id === 'a'), true);
  assert.equal(h.calls.length, 0); assert.deepEqual(h.counts(), { reads: 1, revisionReads: 0 }); c.destroy();
});

test('manual refresh and concurrent polls coalesce, then own-save invalidations wait until Save finishes', async () => {
  const h = harness(), c = h.make(); await c.load();
  const held = h.holdRead(); const one = c.refresh(), two = c.refresh(), poll = c.checkRevision(); await tick();
  assert.deepEqual(h.counts(), { reads: 2, revisionReads: 0 }); held.resolve(h.server()); h.releaseRead(); await Promise.all([one, two, poll]);
  await stage(c, h, edit('a', 610)); const saving = c.saveDraft(); await tick();
  const before = h.counts(); await Promise.all([c.refresh(), c.refresh(), c.checkRevision()]); assert.deepEqual(h.counts(), before);
  h.succeed(0); await saving; await tick(); assert.equal(h.counts().reads, before.reads + 1); c.destroy();
});

test('actor retirement settles a pending Save and prevents later items or old responses reopening state', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 610)); await stage(c, h, edit('b', 700));
  const saving = c.saveDraft(); const rejected = assert.rejects(saving, /timetable_plan_inactive/); await tick();
  c.clearSensitive(); await rejected; h.succeed(0); await tick();
  assert.equal(h.calls.length, 1); assert.equal(c.snapshot().snapshot, null); assert.equal(c.snapshot().dirty, false); assert.equal(h.store.values.size, 0); c.destroy();
});

test('pause settles a pending Save but preserves its submitted identity for same-tab recovery', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 610));
  const saving = c.saveDraft(); const rejected = assert.rejects(saving, /timetable_plan_inactive/); await tick();
  c.pause(); await rejected; assert.equal(h.store.values.size, 1); c.resume();
  assert.equal(c.failureKind('a'), 'uncertain'); const retry = c.retry('a'); await tick(); assert.deepEqual(h.calls[1], h.calls[0]); h.succeed(1); await retry; c.destroy();
});

test('a valid final two-item swap remains local when the existing single-item SQL contract rejects the first save', async () => {
  const wire = snapshot(); wire.items = [item('a'), item('b')];
  wire.slots = [slot('a', 600), { ...slot('b', 700), weekday: 1 }];
  const calls: string[] = [];
  const client = createClient('https://timetable.example.invalid', 'fixture-only', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, init) => {
      const name = String(url).slice(String(url).lastIndexOf('/') + 1); calls.push(name);
      if (name === 'get_timetable_plan_v1') return Response.json(wire);
      assert.equal(name, 'mutate_timetable_plan_item_v1');
      const command = JSON.parse(String(init?.body)).p_command as SavePlanItemCommand;
      // Final timetable_scoped_occupancy SQL :198 validates each candidate
      // against OTHER items' currently saved slots, not a multi-item candidate.
      const clashes = command.slots.some(candidate => wire.slots.some(saved => saved.itemId !== command.item.id
        && saved.weekday === candidate.weekday && saved.startMinute < candidate.endMinute && candidate.startMinute < saved.endMinute
        && (saved.teacherId === candidate.teacherId || saved.classroomId === candidate.classroomId)));
      assert.equal(clashes, true);
      return Response.json({ code: '23P01', message: 'timetable_resource_conflict' }, { status: 409 });
    } },
  });
  const service = createTimetablePlanService({ client, actorScope: 'actor' });
  const c = createTimetablePlanController({ service, actorScope: 'actor', planId: 'plan', storage: null, autoSave: false });
  await c.load();
  await c.dispatch({ operation: 'save', item: item('b'), slots: [{ ...slot('b', 900), weekday: 1 }] });
  await c.dispatch(edit('a', 700));
  await c.dispatch({ operation: 'save', item: item('b'), slots: [{ ...slot('b', 600), weekday: 1 }] });
  assert.deepEqual(c.snapshot().conflicts, []); assert.deepEqual(calls, ['get_timetable_plan_v1']);
  await assert.rejects(c.saveDraft(), (error: { code?: string }) => error.code === '23P01');
  assert.equal(calls.filter(name => name === 'mutate_timetable_plan_item_v1').length, 1);
  assert.equal(c.snapshot().draft?.slots.find(row => row.itemId === 'a')?.startMinute, 700);
  assert.equal(c.snapshot().draft?.slots.find(row => row.itemId === 'b')?.startMinute, 600);
  assert.equal(c.snapshot().snapshot?.slots.find(row => row.itemId === 'a')?.startMinute, 600);
  assert.equal(c.snapshot().dirty, true); c.destroy();
});

test('poll-first and explicit refresh requests share one authoritative read when the revision changed', async () => {
  const h = harness(), c = h.make(); await c.load();
  const held = h.holdRevision(), poll = c.checkRevision(); await tick();
  const one = c.refresh(), two = c.refresh(); await tick();
  assert.deepEqual(h.counts(), { reads: 1, revisionReads: 1 });
  const changed = h.server(); changed.plan.changeSequence++; h.setServer(changed);
  held.resolve({ planId: 'plan', metaRevision: 1, changeSequence: changed.plan.changeSequence, shadowFingerprint: 'weekly', complete: true }); h.releaseRevision();
  await Promise.all([poll, one, two]); assert.deepEqual(h.counts(), { reads: 2, revisionReads: 1 }); c.destroy();
});

test('create then delete is canceled locally and receipt undo stages an inverse without sending it', async () => {
  const h = harness(), c = h.make(); await c.load();
  await stage(c, h, edit('new', 700)); await stage(c, h, { operation: 'delete', itemId: 'new' });
  assert.equal(c.snapshot().dirty, false); assert.equal(h.calls.length, 0);
  await stage(c, h, edit('a', 620)); const saving = c.saveDraft(); await tick(); h.succeed(0); await saving;
  await c.undo(); assert.equal(c.snapshot().dirty, true); assert.equal(c.snapshot().draft?.slots.find(row => row.itemId === 'a')?.startMinute, 600);
  assert.equal(h.calls.length, 1); c.destroy();
});

test('a Save refused before submission preserves local undo history', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 620));
  h.service.readPlan = async () => { throw Error('temporary read error'); }; await c.refresh();
  await assert.rejects(c.saveDraft(), /timetable_reference_unverifiable/);
  assert.equal(c.snapshot().canUndo, true); await c.undo(); assert.equal(c.snapshot().dirty, false); assert.equal(h.calls.length, 0); c.destroy();
});

test('a subscriber reentering Save sees the already-installed flight', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 620));
  let reentered: Promise<void> | undefined;
  const stop = c.subscribe(() => { if (c.snapshot().saving && !reentered) reentered = c.saveDraft(); });
  const saving = c.saveDraft(); assert.equal(reentered, saving); await tick(); assert.equal(h.calls.length, 1);
  h.succeed(0); await saving; stop(); c.destroy();
});

test('retirement before the Save microtask sends nothing and rejects the retired flight', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 620));
  const saving = c.saveDraft(); c.clearSensitive();
  await assert.rejects(saving, /timetable_plan_inactive/); assert.equal(h.calls.length, 0); assert.equal(h.store.values.size, 0); c.destroy();
});

test('local undo retains a collaborator stale warning discovered after the edit', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 610)); await stage(c, h, edit('a', 620));
  const changed = h.server(); changed.items[0].revision = 2; changed.plan.changeSequence++; h.setServer(changed); await c.refresh();
  await c.undo(); assert.equal(c.failureKind('a'), 'stale'); assert.equal(c.snapshot().saveState, 'stale');
  assert.equal(c.snapshot().pendingOperations[0].discardable, true);
  await assert.rejects(c.saveDraft(), /timetable_stale/); assert.equal(h.calls.length, 0); c.destroy();
});

test('an invalidation arriving during an older read gets one follow-up authoritative read', async () => {
  const h = harness(), c = h.make(); await c.load();
  const old = structuredClone(h.server()), held = h.holdRead(), first = c.refresh(); await tick();
  const changed = h.server(); changed.shadowFingerprint = 'changed-operating'; h.setServer(changed);
  const invalidated = c.refresh(); h.releaseRead(); held.resolve(old); await Promise.all([first, invalidated]); await tick();
  assert.equal(c.snapshot().snapshot?.shadowFingerprint, 'changed-operating');
  assert.deepEqual(h.counts(), { reads: 3, revisionReads: 0 }); c.destroy();
});

test('an old read begun before Save cannot replace its receipt and triggers only one final read', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 620));
  const old = structuredClone(h.server()), held = h.holdRead(), reading = c.refresh(); await tick();
  const saving = c.saveDraft(); await tick(); h.releaseRead(); h.succeed(0); await saving; await tick();
  held.resolve(old); await reading;
  assert.equal(c.snapshot().snapshot?.slots.find(row => row.itemId === 'a')?.startMinute, 620);
  assert.deepEqual(h.counts(), { reads: 3, revisionReads: 0 }); c.destroy();
});

test('moving to the old baseline after a collaborator change preserves that local intent as stale', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 610));
  const changed = h.server(); changed.items[0].revision = 2; changed.slots[0] = slot('a', 700); changed.plan.changeSequence++; h.setServer(changed); await c.refresh();
  await stage(c, h, edit('a', 600));
  assert.equal(c.snapshot().dirty, true); assert.equal(c.snapshot().draft?.slots.find(row => row.itemId === 'a')?.startMinute, 600);
  assert.equal(c.failureKind('a'), 'stale'); await assert.rejects(c.saveDraft(), /timetable_stale/); assert.equal(h.calls.length, 0); c.destroy();
});

test('retirement after submitted-body publication cannot initiate its network request', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 620));
  let retired = false;
  const stop = c.subscribe(() => {
    const recovery = JSON.parse([...h.store.values.values()][0] ?? '{}');
    if (!retired && recovery.entries?.[0]?.submitted) { retired = true; c.clearSensitive(); }
  });
  await assert.rejects(c.saveDraft(), /timetable_plan_inactive/);
  assert.equal(retired, true); assert.equal(h.calls.length, 0); assert.equal(h.store.values.size, 0); stop(); c.destroy();
});

test('retrying a recovered submitted head never auto-sends its later unsent legacy intent', async () => {
  const h = harness(); let c = h.make(); await c.load(); await stage(c, h, edit('a', 620));
  const saving = c.saveDraft(), rejected = assert.rejects(saving); await tick();
  const original = structuredClone(h.calls[0]); h.replies[0].reject(Error('response lost')); await rejected;
  const key = [...h.store.values.keys()][0], recovery = JSON.parse(h.store.values.get(key)!);
  recovery.entries.push({ edit: edit('a', 640), submitted: null, status: 'queued', itemName: 'a' });
  h.store.values.set(key, JSON.stringify(recovery)); c.destroy(); c = h.make(); await c.load();
  const retry = c.retry('a'); await tick(); assert.deepEqual(h.calls[1], original); h.succeed(1); await retry;
  assert.equal(h.calls.length, 2); assert.equal(c.snapshot().saveState, 'draft');
  assert.equal(c.snapshot().draft?.slots.find(row => row.itemId === 'a')?.startMinute, 640);
  const next = c.saveDraft(); await tick(); assert.equal(h.calls[2].expectedItemRevision, 2); h.succeed(2); await next; c.destroy();
});

test('changed operating fingerprint in a successful receipt stops later items and rereads once without deadlock', async () => {
  const h = harness(), c = h.make(); await c.load(); await stage(c, h, edit('a', 620)); await stage(c, h, edit('b', 700));
  const saving = c.saveDraft(), rejected = assert.rejects(saving, /timetable_reference_unverifiable/); await tick();
  const changed = h.server(); changed.shadowFingerprint = 'new-operating'; h.setServer(changed); h.succeed(0);
  await rejected; await tick();
  assert.equal(h.calls.length, 1); assert.equal(c.snapshot().referenceStatus, 'verified');
  assert.equal(c.snapshot().snapshot?.shadowFingerprint, 'new-operating'); assert.equal(c.snapshot().dirty, true);
  assert.deepEqual(h.counts(), { reads: 2, revisionReads: 0 }); c.destroy();
});

test('top Save replays a recovered immutable head and saves only its latest unsent tail before fulfilling', async () => {
  const h = harness(); let c = h.make(); await c.load(); await stage(c, h, edit('a', 610));
  const originalSave = c.saveDraft(), originalRejected = assert.rejects(originalSave); await tick();
  const original = structuredClone(h.calls[0]); h.replies[0].reject(Error('response lost')); await originalRejected;
  const key = [...h.store.values.keys()][0], recovery = JSON.parse(h.store.values.get(key)!);
  recovery.entries.push({ edit: edit('a', 620), submitted: null, status: 'queued', itemName: 'a' });
  recovery.entries.push({ edit: edit('a', 630), submitted: null, status: 'queued', itemName: 'a' });
  h.store.values.set(key, JSON.stringify(recovery)); c.destroy(); c = h.make(); await c.load();
  const saving = c.saveDraft(); let fulfilled = false; void saving.then(() => { fulfilled = true; });
  await tick(); assert.deepEqual(h.calls[1], original); h.succeed(1); await tick();
  assert.equal(h.calls.length, 3, 'top Save must send the latest local tail after confirming the immutable head');
  assert.equal(fulfilled, false); assert.equal(h.calls[2].operation, 'save');
  if (h.calls[2].operation === 'save') { assert.equal(h.calls[2].slots[0].startMinute, 630); assert.equal(h.calls[2].expectedItemRevision, 2); }
  assert.notEqual(h.calls[2].requestKey, original.requestKey); h.succeed(2); await saving;
  assert.equal(c.snapshot().dirty, false); assert.equal(c.snapshot().snapshot?.slots.find(row => row.itemId === 'a')?.startMinute, 630);
  assert.equal(h.calls.length, 3); c.destroy();
});

test('top Save confirms an already committed receipt before saving its recovered local tail', async () => {
  const h = harness(); let c = h.make(); await c.load(); await stage(c, h, edit('a', 610));
  const first = c.saveDraft(), rejected = assert.rejects(first); await tick(); const original = structuredClone(h.calls[0]);
  const committed = h.server(); committed.items[0].revision = 2; committed.slots[0] = slot('a', 610); committed.plan.changeSequence = 2; h.setServer(committed);
  h.replies[0].reject(Error('response lost')); await rejected;
  const key = [...h.store.values.keys()][0], recovery = JSON.parse(h.store.values.get(key)!);
  recovery.entries.push({ edit: edit('a', 620), submitted: null, status: 'queued', itemName: 'a' });
  h.store.values.set(key, JSON.stringify(recovery)); c.destroy(); c = h.make(); await c.load();
  assert.equal(c.failureKind('a'), 'uncertain');
  const saving = c.saveDraft(); await tick(); assert.deepEqual(h.calls[1], original);
  h.replies[1].resolve({ planId: 'plan', metaRevision: 1, changeSequence: 2, shadowFingerprint: 'weekly',
    item: { ...item('a'), revision: 2 }, slots: [slot('a', 610)], removedItemIds: [] });
  await tick(); assert.equal(h.calls.length, 3); assert.equal(h.calls[2].expectedItemRevision, 2); h.succeed(2); await saving;
  assert.equal(c.snapshot().dirty, false); assert.equal(c.snapshot().snapshot?.slots.find(row => row.itemId === 'a')?.startMinute, 620); c.destroy();
});

test('a recovered tail failure rejects top Save and preserves the new tail receipt for exact retry', async () => {
  const h = harness(); let c = h.make(); await c.load(); await stage(c, h, edit('a', 610));
  const first = c.saveDraft(), firstRejected = assert.rejects(first); await tick(); h.replies[0].reject(Error('response lost')); await firstRejected;
  const key = [...h.store.values.keys()][0], recovery = JSON.parse(h.store.values.get(key)!);
  recovery.entries.push({ edit: edit('a', 620), submitted: null, status: 'queued', itemName: 'a' });
  h.store.values.set(key, JSON.stringify(recovery)); c.destroy(); c = h.make(); await c.load();
  const saving = c.saveDraft(), rejected = assert.rejects(saving, /tail response lost/); await tick(); h.succeed(1); await tick();
  assert.equal(h.calls.length, 3); const tail = structuredClone(h.calls[2]); h.replies[2].reject(Error('tail response lost')); await rejected;
  assert.equal(c.snapshot().snapshot?.slots.find(row => row.itemId === 'a')?.startMinute, 610);
  assert.equal(c.snapshot().draft?.slots.find(row => row.itemId === 'a')?.startMinute, 620); assert.equal(c.failureKind('a'), 'uncertain');
  const retry = c.retry('a'); await tick(); assert.deepEqual(h.calls[3], tail); h.succeed(3); await retry;
  assert.equal(c.snapshot().dirty, false); c.destroy();
});
