import type { DropTarget, PlanSlot } from "./timetable-plan-contract.ts";

export function assertWeekday(weekday: number): void {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new RangeError("weekday must be an integer from 0 to 6");
  }
}

export function assertInterval(startMinute: number, endMinute: number): void {
  if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute)
    || startMinute < 0 || startMinute >= endMinute || endMinute > 1440) {
    throw new RangeError("time must be an integer interval within one day");
  }
}

export function moveSlot(slot: PlanSlot, target: DropTarget): PlanSlot {
  assertWeekday(slot.weekday);
  assertInterval(slot.startMinute, slot.endMinute);
  assertWeekday(target.weekday);
  const endMinute = target.startMinute + slot.endMinute - slot.startMinute;
  assertInterval(target.startMinute, endMinute);
  if (target.teacherId !== undefined && !target.teacherId) {
    throw new RangeError("teacherId must not be empty");
  }
  if (target.classroomId !== undefined && !target.classroomId) {
    throw new RangeError("classroomId must not be empty");
  }
  return {
    ...slot,
    ...target,
    endMinute,
  };
}

import type {
  DeletePlanItemCommand, PlanItemDraft, PlanMutationResult, PlanSnapshot,
  SavePlanItemCommand, TimetableConflict, TransferResult,
} from './timetable-plan-contract.ts';
import type { TimetablePlanService } from './timetable-plan-service.ts';
import { findConflicts, findOperatingConflicts, operatingReferenceComplete } from './timetable-conflicts.ts';

export type TimetableItemEdit =
  | { operation: 'save'; item: PlanItemDraft; slots: PlanSlot[] }
  | { operation: 'delete'; itemId: string };
export type TimetableSaveState = 'idle' | 'saving' | 'saved' | 'error' | 'stale';
export type TimetableControllerState = {
  snapshot: PlanSnapshot | null;
  draft: PlanSnapshot | null;
  saveState: TimetableSaveState;
  conflicts: TimetableConflict[];
  error: unknown | null;
  referenceStatus: 'unknown' | 'verified' | 'unverifiable';
  recoveryAvailable: boolean;
  dirty: boolean;
};
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Pending = {
  edit: TimetableItemEdit;
  submitted: SavePlanItemCommand | DeletePlanItemCommand | null;
  status: 'queued' | 'sending' | 'error';
  expectedItemRevision?: number | null;
  resolve?: () => void;
  reject?: (error: unknown) => void;
};
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const availableSessionStorage = (): StorageLike | null => { try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; } };
const storageKey = (actorScope: string, planId: string) => `tips:timetable:draft:v1:${encodeURIComponent(actorScope)}:${encodeURIComponent(planId)}`;
const isAccessError = (error: unknown) => {
  const value = error as { code?: string; status?: number; message?: string } | null;
  return value?.code === '42501' || value?.code === '28000' || value?.code === '28P01'
    || value?.code === 'PGRST301' || value?.status === 401 || value?.status === 403
    || value?.message === 'timetable_forbidden';
};
const isStaleError = (error: unknown) => (error as { message?: string } | null)?.message === 'timetable_stale';
const periodOf = (snapshot: PlanSnapshot) => snapshot.plan.targetStartDate && snapshot.plan.targetEndDate
  ? { startDate: snapshot.plan.targetStartDate, endDate: snapshot.plan.targetEndDate } : null;
const toItemDraft = (item: PlanItemDraft): PlanItemDraft => ({
  id: item.id, planId: item.planId, name: item.name, subject: item.subject,
  subjectAreaKey: item.subjectAreaKey, grade: item.grade, capacity: item.capacity, tuition: item.tuition,
  defaultTeacherId: item.defaultTeacherId, defaultClassroomId: item.defaultClassroomId,
  durationMinutes: item.durationMinutes, pendingSlots: item.pendingSlots,
});
function overlay(base: PlanSnapshot, pending: Pending[]): PlanSnapshot {
  const draft: PlanSnapshot = structuredClone(base);
  for (const { edit } of pending) {
    if (edit.operation === 'delete') {
      draft.items = draft.items.filter((item) => item.id !== edit.itemId);
      draft.slots = draft.slots.filter((slot) => slot.itemId !== edit.itemId);
    } else {
      const existing = draft.items.find((item) => item.id === edit.item.id);
      const next = { ...existing, ...edit.item, revision: existing?.revision ?? 0,
        sourceClassId: existing?.sourceClassId ?? null, state: 'draft' as const,
        appliedClassId: null, appliedTransferId: null, appliedAt: null };
      draft.items = [...draft.items.filter((item) => item.id !== edit.item.id), next];
      draft.slots = [...draft.slots.filter((slot) => slot.itemId !== edit.item.id), ...structuredClone(edit.slots)];
    }
  }
  return draft;
}
function mergeReceipt(base: PlanSnapshot, result: PlanMutationResult): PlanSnapshot {
  if (result.planId !== base.plan.id) throw new Error('timetable_plan_response_invalid');
  const next: PlanSnapshot = structuredClone(base);
  const previous = result.item && next.items.find((item) => item.id === result.item?.id);
  if (result.item && (!previous || result.item.revision > previous.revision)) {
    next.items = [...next.items.filter((item) => item.id !== result.item?.id), result.item];
    next.slots = [...next.slots.filter((slot) => slot.itemId !== result.item?.id), ...result.slots];
  }
  for (const id of result.removedItemIds) {
    // An older receipt cannot remove an item that was recreated in a newer snapshot.
    if (result.changeSequence >= base.plan.changeSequence) {
      next.items = next.items.filter((item) => item.id !== id);
      next.slots = next.slots.filter((slot) => slot.itemId !== id);
    }
  }
  if (result.changeSequence >= base.plan.changeSequence) {
    next.plan.changeSequence = result.changeSequence;
    // The receipt contains no shadow rows; the last authorized snapshot owns their fingerprint.
  }
  next.plan.metaRevision = Math.max(base.plan.metaRevision, result.metaRevision);
  return next;
}

/** Pure state owner for one actor and one plan. UI subscribes; it never edits React internals for a retry. */
export function createTimetablePlanController({ service, actorScope, planId, storage = availableSessionStorage(),
  requestKey = () => crypto.randomUUID() }: {
  service: Pick<TimetablePlanService, 'readPlan' | 'readRevision' | 'saveItem'>;
  actorScope: string; planId: string; storage?: StorageLike | null; requestKey?: () => string;
}) {
  if (!actorScope || !planId) throw new Error('timetable_plan_scope_missing');
  const key = storageKey(actorScope, planId);
  const listeners = new Set<() => void>();
  const queues = new Map<string, Pending[]>();
  const running = new Set<string>();
  const staleItems = new Set<string>();
  const retrying = new Set<string>();
  const itemEpoch = new Map<string, number>();
  let readGeneration = 0;
  const controllers = new Set<AbortController>();
  let epoch = 0;
  let disposed = false;
  let lastUndo: { edit: TimetableItemEdit; expectedItemRevision: number | null } | null = null;
  let state: TimetableControllerState = { snapshot: null, draft: null, saveState: 'idle', conflicts: [], error: null,
    referenceStatus: 'unknown', recoveryAvailable: true, dirty: false };
  const publish = (patch: Partial<TimetableControllerState> = {}) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const pending = () => [...queues.values()].flat();
  const persist = () => {
    if (!storage) { publish({ recoveryAvailable: false }); return; }
    try {
      const entries = pending().map(({ edit, submitted, status, expectedItemRevision }) => ({ edit, submitted, status, expectedItemRevision }));
      if (entries.length) storage.setItem(key, JSON.stringify({ version: 1, entries }));
      else storage.removeItem(key);
    } catch { publish({ recoveryAvailable: false }); }
  };
  const rebuild = (saveState?: TimetableSaveState, error?: unknown) => {
    if (!state.snapshot) return;
    const draft = overlay(state.snapshot, pending());
    const period = periodOf(state.snapshot);
    let conflicts: TimetableConflict[] = [];
    try {
      conflicts = [...findConflicts(draft.slots, state.snapshot.shadowSlots),
        ...findOperatingConflicts(draft.slots, { ...state.snapshot, shadowSlots: [] }, period)];
    } catch { /* Malformed local input remains editable and server validation fails closed. */ }
    const complete = operatingReferenceComplete(state.snapshot, period);
    publish({ draft, conflicts, dirty: pending().length > 0,
      saveState: saveState ?? (!complete || state.referenceStatus !== 'verified' || staleItems.size > 0 ? 'stale'
        : pending().some((entry) => entry.status === 'error') ? 'error'
          : pending().length ? 'saving' : state.saveState === 'idle' ? 'idle' : 'saved'),
      error: error === undefined ? state.error : error });
  };
  const clearSensitive = () => {
    epoch += 1;
    for (const controller of controllers) controller.abort();
    controllers.clear(); queues.clear(); running.clear(); staleItems.clear(); retrying.clear(); itemEpoch.clear(); lastUndo = null;
    try { storage?.removeItem(key); } catch { /* Storage access can fail after logout. */ }
    publish({ snapshot: null, draft: null, saveState: 'idle', conflicts: [], error: null,
      referenceStatus: 'unknown', dirty: false });
  };
  const restore = () => {
    if (!storage) return;
    try {
      const raw = storage.getItem(key);
      if (!raw) return;
      const saved: unknown = JSON.parse(raw);
      if (!isObject(saved) || saved.version !== 1 || !Array.isArray(saved.entries)) throw Error('invalid recovery');
      for (const entry of saved.entries) {
        if (!isObject(entry) || !isObject(entry.edit) || !['save', 'delete'].includes(String(entry.edit.operation))) throw Error('invalid recovery');
        const edit = entry.edit as TimetableItemEdit;
        const itemId = edit.operation === 'save' ? edit.item?.id : edit.itemId;
        if (!itemId || (edit.operation === 'save' && (edit.item.planId !== planId || !Array.isArray(edit.slots)))) throw Error('invalid recovery');
        const queue = queues.get(itemId) ?? [];
        const submitted = isObject(entry.submitted) && entry.submitted.planId === planId && typeof entry.submitted.requestKey === 'string'
          ? entry.submitted as SavePlanItemCommand | DeletePlanItemCommand : null;
        queue.push({ edit, submitted, status: submitted ? 'error' : 'queued',
          expectedItemRevision: typeof entry.expectedItemRevision === 'number' || entry.expectedItemRevision === null
            ? entry.expectedItemRevision : undefined });
        queues.set(itemId, queue);
      }
    } catch { queues.clear(); try { storage.removeItem(key); } catch { /* No recovery. */ } }
  };
  const scoped = async <T>(run: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    const token = epoch;
    const abort = new AbortController(); controllers.add(abort);
    try { const result = await run(abort.signal); return !disposed && token === epoch ? result : undefined; }
    finally { controllers.delete(abort); }
  };
  const refresh = async () => {
    const token = epoch;
    const generation = ++readGeneration;
    try {
      const next = await scoped((signal) => service.readPlan(planId, { signal }));
      if (!next || token !== epoch || generation !== readGeneration) return;
      if (next.plan.id !== planId) throw new Error('timetable_plan_response_invalid');
      if (state.snapshot && (next.plan.changeSequence < state.snapshot.plan.changeSequence
        || (next.plan.changeSequence === state.snapshot.plan.changeSequence
          && next.plan.metaRevision < state.snapshot.plan.metaRevision))) return;
      const old = state.snapshot;
      for (const [id, queue] of queues) {
        if (!queue.length) continue;
        const currentRevision = next.items.find((item) => item.id === id)?.revision ?? null;
        const expected = queue[0].submitted?.expectedItemRevision
          ?? queue[0].expectedItemRevision ?? old?.items.find((item) => item.id === id)?.revision ?? null;
        if (currentRevision !== expected) staleItems.add(id);
      }
      const externallyChanged = staleItems.size > 0;
      publish({ snapshot: next, referenceStatus: 'verified', error: null });
      rebuild(externallyChanged ? 'stale' : undefined);
    } catch (error) {
      if (disposed || token !== epoch || generation !== readGeneration) return;
      if (isAccessError(error)) clearSensitive();
      else { publish({ referenceStatus: 'unverifiable', error }); rebuild('stale', error); }
    }
  };
  const load = async () => {
    if (!state.snapshot && pending().length === 0) restore();
    await refresh();
    if (state.snapshot && pending().length) rebuild('stale');
  };
  const runQueue = (itemId: string) => {
    if (running.has(itemId) || (staleItems.has(itemId) && !retrying.has(itemId)) || disposed || !state.snapshot || state.referenceStatus !== 'verified') return;
    const queue = queues.get(itemId);
    if (!queue?.length || queue[0].status === 'error') return;
    running.add(itemId);
    const token = epoch;
    const generation = itemEpoch.get(itemId) ?? 0;
    void (async () => {
      try {
        while (!disposed && token === epoch && generation === (itemEpoch.get(itemId) ?? 0)
          && queue.length && queue[0].status !== 'error' && (!staleItems.has(itemId) || retrying.has(itemId))) {
          const entry = queue[0];
          const base = state.snapshot;
          if (!base || state.referenceStatus !== 'verified') break;
          if (!operatingReferenceComplete(base, periodOf(base))) { rebuild('stale'); break; }
          const revision = base.items.find((item) => item.id === itemId)?.revision ?? null;
          if (entry.expectedItemRevision !== undefined && entry.expectedItemRevision !== revision) {
            const error = Error('timetable_stale');
            entry.status = 'error'; staleItems.add(itemId); persist(); rebuild('stale', error); entry.reject?.(error); break;
          }
          const priorItem = base.items.find((item) => item.id === itemId);
          const priorSlots = base.slots.filter((slot) => slot.itemId === itemId);
          const inverse: TimetableItemEdit | null = priorItem
            ? { operation: 'save', item: toItemDraft(priorItem), slots: structuredClone(priorSlots) }
            : entry.edit.operation === 'save' ? { operation: 'delete', itemId } : null;
          const submitted = entry.submitted ?? (entry.edit.operation === 'save'
            ? { operation: 'save' as const, planId, expectedMetaRevision: base.plan.metaRevision,
              expectedShadowFingerprint: base.shadowFingerprint, expectedItemRevision: entry.expectedItemRevision ?? revision,
              item: toItemDraft(entry.edit.item), slots: structuredClone(entry.edit.slots), requestKey: requestKey() }
            : { operation: 'delete' as const, planId, itemId, expectedMetaRevision: base.plan.metaRevision,
              expectedShadowFingerprint: base.shadowFingerprint, expectedItemRevision: entry.expectedItemRevision ?? revision!, requestKey: requestKey() });
          entry.submitted = structuredClone(submitted);
          entry.status = 'sending'; persist(); rebuild('saving');
          try {
            const response = await scoped((signal) => service.saveItem(submitted, { signal }));
            if (!response || token !== epoch || generation !== (itemEpoch.get(itemId) ?? 0)) break;
            if (!state.snapshot) break;
            const shadowChanged = response.shadowFingerprint !== state.snapshot.shadowFingerprint;
            const updated = mergeReceipt(state.snapshot, response);
            queue.shift(); if (!queue.length) { queues.delete(itemId); staleItems.delete(itemId); }
            if (inverse) lastUndo = { edit: inverse, expectedItemRevision: response.item?.revision ?? null };
            publish({ snapshot: updated, error: null }); persist(); rebuild();
            entry.resolve?.();
            if (staleItems.has(itemId)) { retrying.delete(itemId); rebuild('stale'); break; }
            if (shadowChanged) {
              await refresh();
              if (state.referenceStatus !== 'verified') break;
            }
          } catch (error) {
            if (disposed || token !== epoch || generation !== (itemEpoch.get(itemId) ?? 0)) break;
            if (isAccessError(error)) { clearSensitive(); entry.reject?.(error); break; }
            entry.status = 'error'; if (isStaleError(error)) staleItems.add(itemId);
            persist(); rebuild(isStaleError(error) ? 'stale' : 'error', error);
            entry.reject?.(error); break;
          }
        }
      } finally { if (generation === (itemEpoch.get(itemId) ?? 0)) { running.delete(itemId); retrying.delete(itemId); } }
    })();
  };
  const dispatch = (edit: TimetableItemEdit, expectedItemRevision?: number | null): Promise<void> => {
    if (!state.snapshot || state.snapshot.plan.id !== planId || !state.snapshot.permissions.canEdit
      || state.snapshot.plan.state !== 'draft') return Promise.reject(Error('timetable_forbidden'));
    const itemId = edit.operation === 'save' ? edit.item.id : edit.itemId;
    if (!itemId || (edit.operation === 'save' && (edit.item.planId !== planId
      || edit.slots.some((slot) => slot.planId !== planId || slot.itemId !== itemId)))) return Promise.reject(Error('timetable_invalid'));
    let rejectSave!: (error: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => {
      rejectSave = reject;
      const queue = queues.get(itemId) ?? [];
      queue.push({ edit: structuredClone(edit), submitted: null, status: 'queued', expectedItemRevision, resolve, reject });
      queues.set(itemId, queue);
    });
    const blocked = state.referenceStatus !== 'verified'
      || !operatingReferenceComplete(state.snapshot, periodOf(state.snapshot)) || staleItems.has(itemId);
    if (blocked) {
      const queue = queues.get(itemId)!;
      queue[queue.length - 1].status = 'error';
      persist(); rebuild('stale', Error('timetable_reference_unverifiable'));
      rejectSave(Error(staleItems.has(itemId) ? 'timetable_stale' : 'timetable_reference_unverifiable'));
    } else { persist(); rebuild(); runQueue(itemId); }
    return promise;
  };
  const undo = (): Promise<void> => {
    if (!lastUndo) return Promise.reject(Error('timetable_undo_unavailable'));
    const inverse = structuredClone(lastUndo);
    lastUndo = null;
    return dispatch(inverse.edit, inverse.expectedItemRevision);
  };
  const retry = async (itemId?: string): Promise<void> => {
    if (!state.snapshot || state.referenceStatus !== 'verified') throw Error('timetable_reference_unverifiable');
    const targets = itemId ? [itemId] : [...queues.keys()];
    // Explicit retry reuses the submitted body; the server rechecks revisions and access.
    const promises: Promise<void>[] = [];
    for (const id of targets) {
      const queue = queues.get(id);
      if (!queue?.length || queue[0].status === 'sending') continue;
      if (staleItems.has(id) && !queue[0].submitted) throw Error('timetable_stale');
      const entry = queue[0];
      if (staleItems.has(id)) retrying.add(id);
      entry.status = 'queued';
      promises.push(new Promise<void>((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; }));
      runQueue(id);
    }
    persist(); rebuild();
    await Promise.all(promises);
  };
  const resolveStale = (itemId: string, choice: 'accept_server' | 'reapply_draft'): Promise<void> => {
    if (!staleItems.has(itemId) || !state.snapshot || !state.draft) return Promise.reject(Error('timetable_stale_resolution_unavailable'));
    const oldQueue = queues.get(itemId);
    const desired = oldQueue?.[oldQueue.length - 1]?.edit;
    const desiredDraft = state.draft;
    if (!desired) return Promise.reject(Error('timetable_stale_resolution_unavailable'));
    // Invalidate an in-flight reply for this item without cancelling independent items.
    itemEpoch.set(itemId, (itemEpoch.get(itemId) ?? 0) + 1);
    running.delete(itemId);
    for (const entry of oldQueue ?? []) entry.reject?.(Error('timetable_stale_discarded'));
    if (oldQueue) oldQueue.length = 0;
    queues.delete(itemId); staleItems.delete(itemId); retrying.delete(itemId);
    if (lastUndo && (lastUndo.edit.operation === 'save' ? lastUndo.edit.item.id : lastUndo.edit.itemId) === itemId) lastUndo = null;
    persist(); rebuild();
    if (choice === 'accept_server') return Promise.resolve();
    // Reapply is an explicit new intent, with a new key/revision; ambiguous retry is separate.
    const draftItem = desiredDraft.items.find((item) => item.id === itemId);
    const edit: TimetableItemEdit = desired.operation === 'delete' || !draftItem
      ? { operation: 'delete', itemId }
      : { operation: 'save', item: toItemDraft(draftItem), slots: desiredDraft.slots.filter((slot) => slot.itemId === itemId) };
    return dispatch(edit);
  };
  const checkRevision = async () => {
    if (disposed || !state.snapshot) return;
    const token = epoch;
    try {
      const revision = await scoped((signal) => service.readRevision(planId, { signal }));
      if (!revision || !state.snapshot || token !== epoch) return;
      if (revision.planId !== planId) throw new Error('timetable_plan_response_invalid');
      if (revision.changeSequence !== state.snapshot.plan.changeSequence
        || revision.metaRevision !== state.snapshot.plan.metaRevision
        || revision.shadowFingerprint !== state.snapshot.shadowFingerprint
        || revision.complete !== state.snapshot.complete) await refresh();
    } catch (error) {
      if (disposed || token !== epoch) return;
      if (isAccessError(error)) clearSensitive();
      else { publish({ referenceStatus: 'unverifiable', error }); rebuild('stale', error); }
    }
  };
  const applyTransfer = (result: TransferResult) => {
    const base = state.snapshot;
    if (!base) return;
    if (result.snapshot) {
      if (result.snapshot.plan.id !== planId || result.snapshot.plan.changeSequence < base.plan.changeSequence) return;
      publish({ snapshot: result.snapshot, referenceStatus: 'verified', error: null }); rebuild(); return;
    }
    if (!result.addedShadowClasses || !result.sourcePlan || !result.operatingReference
      || result.sourcePlan.id !== planId || result.sourcePlan.changeSequence < base.plan.changeSequence
      || result.operatingReference.shadowFingerprint !== result.shadowFingerprint) throw Error('timetable_plan_response_invalid');
    const next = structuredClone(base);
    for (const applied of result.appliedItems) {
      next.appliedSnapshots = [...next.appliedSnapshots.filter((entry) => entry.itemId !== applied.id),
        { itemId: applied.id, slots: next.slots.filter((slot) => slot.itemId === applied.id) }];
    }
    next.items = [...next.items.filter((item) => !result.removedItemIds.includes(item.id)
      && !result.appliedItems.some((applied) => applied.id === item.id)), ...result.appliedItems,
      ...result.createdItems.filter((item) => item.planId === planId)];
    next.slots = [...next.slots.filter((slot) => !result.removedItemIds.includes(slot.itemId)
      && !result.appliedItems.some((applied) => applied.id === slot.itemId)),
      ...result.createdSlots.filter((slot) => slot.planId === planId)];
    next.plan = result.sourcePlan;
    Object.assign(next, result.operatingReference);
    next.capacity.itemCount = next.items.length;
    next.capacity.slotCount = next.slots.length;
    publish({ snapshot: next, referenceStatus: 'verified', error: null }); rebuild();
  };
  return { snapshot: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load, refresh, checkRevision, dispatch, undo, retry, resolveStale, applyTransfer, clearSensitive,
    destroy: () => { disposed = true; epoch += 1; for (const controller of controllers) controller.abort(); controllers.clear(); listeners.clear(); } };
}
