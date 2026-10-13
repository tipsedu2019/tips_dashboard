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
  BatchPlanItemsCommand, BatchSaveResult, DeletePlanItemCommand, PlanItemDraft, PlanMutationResult, PlanSnapshot,
  SavePlanItemCommand, TimetableConflict, TransferResult,
} from './timetable-plan-contract.ts';
import { requireTimetableBatchResult, requireTimetableTransferResult, type TimetablePlanService } from './timetable-plan-service.ts';
import { findConflicts, findOperatingConflicts, operatingReferenceComplete } from './timetable-conflicts.ts';
import { availableTimetableSessionStorage, timetableDraftStorageKey, type TimetableDraftStorage } from './timetable-plan-recovery.ts';

export type TimetableItemEdit =
  | { operation: 'save'; item: PlanItemDraft; slots: PlanSlot[] }
  | { operation: 'delete'; itemId: string };
export type TimetableSaveState = 'idle' | 'draft' | 'saving' | 'saved' | 'error' | 'stale';
export type TimetableControllerState = {
  snapshot: PlanSnapshot | null;
  draft: PlanSnapshot | null;
  saveState: TimetableSaveState;
  conflicts: TimetableConflict[];
  error: unknown | null;
  referenceStatus: 'unknown' | 'verified' | 'unverifiable';
  recoveryAvailable: boolean;
  dirty: boolean;
  pendingOperations: { itemId: string; operation: 'save' | 'delete'; name: string; failure: 'rejected' | 'uncertain' | 'stale' | null; discardable?: boolean }[];
  saving?: boolean;
  canDiscardDraft?: boolean;
  canUndo?: boolean;
};
type StorageLike = TimetableDraftStorage;
type Pending = {
  edit: TimetableItemEdit;
  submitted: SavePlanItemCommand | DeletePlanItemCommand | null;
  status: 'queued' | 'sending' | 'error';
  expectedItemRevision?: number | null;
  baseEdit?: TimetableItemEdit;
  confirmedRejection?: boolean;
  confirmedStale?: boolean;
  itemName?: string;
  resolve?: () => void;
  reject?: (error: unknown) => void;
};
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isAccessError = (error: unknown) => {
  const value = error as { code?: string; status?: number; message?: string } | null;
  return value?.code === '42501' || value?.code === '28000' || value?.code === '28P01'
    || value?.code === 'PGRST301' || value?.status === 401 || value?.status === 403
    || value?.message === 'timetable_forbidden';
};
const isConfirmedRejection = (error: unknown) => {
  const value = error as { code?: string; message?: string } | null;
  return (value?.code === '23P01' && value.message === 'timetable_resource_conflict')
    || (value?.code === '22023' && ['timetable_invalid', 'timetable_capacity'].includes(value.message || ''));
};
const isStaleError = (error: unknown) => {
  const value = error as { code?: string; message?: string } | null;
  return value?.code === 'P0001' && value.message === 'timetable_stale';
};
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
function receiptMatchesCurrentItem(base: PlanSnapshot, result: PlanMutationResult): boolean {
  if (result.item === null) return result.removedItemIds.every((id) => !base.items.some((item) => item.id === id));
  const current = base.items.find((item) => item.id === result.item?.id);
  if (!current || current.revision !== result.item.revision) return false;
  const slots = base.slots.filter((slot) => slot.itemId === result.item?.id);
  const position = (slot: PlanSlot) => [slot.id, slot.weekday, slot.startMinute, slot.endMinute,
    slot.teacherId, slot.classroomId, slot.sourceSlotId].join(':');
  return slots.length === result.slots.length
    && slots.map(position).sort().every((value, index) => value === result.slots.map(position).sort()[index]);
}
function receiptSuperseded(base: PlanSnapshot, result: PlanMutationResult, authoritativeReadSequence: number, itemReceiptSequence: Map<string, number>): boolean {
  if (result.item) {
    const current = base.items.find((item) => item.id === result.item?.id);
    return current ? current.revision > result.item.revision
      || (current.revision === result.item.revision && !receiptMatchesCurrentItem(base, result))
      : result.changeSequence <= authoritativeReadSequence
        || (itemReceiptSequence.get(result.item.id) ?? -1) >= result.changeSequence;
  }
  return result.removedItemIds.some((id) => base.items.some((item) => item.id === id)
    && (result.changeSequence <= authoritativeReadSequence
      || (itemReceiptSequence.get(id) ?? -1) > result.changeSequence));
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
    next.items = next.items.filter((item) => item.id !== id);
    next.slots = next.slots.filter((slot) => slot.itemId !== id);
  }
  if (result.changeSequence >= base.plan.changeSequence) {
    next.plan.changeSequence = result.changeSequence;
    // The receipt contains no shadow rows; the last authorized snapshot owns their fingerprint.
  }
  next.plan.metaRevision = Math.max(base.plan.metaRevision, result.metaRevision);
  return next;
}

/** Pure state owner for one actor and one plan. UI subscribes; it never edits React internals for a retry. */
export function createTimetablePlanController({ service, actorScope, planId, storage = availableTimetableSessionStorage(),
  requestKey = () => crypto.randomUUID(), autoSave = true }: {
  service: Pick<TimetablePlanService, 'readPlan' | 'readRevision' | 'saveItem'> & Partial<Pick<TimetablePlanService, 'saveBatch'>>;
  actorScope: string; planId: string; storage?: StorageLike | null; requestKey?: () => string; autoSave?: boolean;
}) {
  if (!actorScope || !planId) throw new Error('timetable_plan_scope_missing');
  const key = timetableDraftStorageKey(actorScope, planId);
  const listeners = new Set<() => void>();
  const queues = new Map<string, Pending[]>();
  const running = new Set<string>();
  const staleItems = new Set<string>();
  const retrying = new Set<string>();
  const itemEpoch = new Map<string, number>();
  // Only a complete authorized read proves absence across all items. A receipt proves only its own item.
  const itemReceiptSequence = new Map<string, number>();
  let authoritativeReadSequence = -1;
  let readGeneration = 0;
  const controllers = new Set<AbortController>();
  let epoch = 0;
  let disposed = false;
  let paused = false;
  let lastUndo: { edit: TimetableItemEdit; expectedItemRevision: number | null } | null = null;
  const localUndo: Array<{ itemId: string; previous: Pending | null; stale: boolean }> = [];
  let saveFlight: Promise<void> | null = null;
  let batchRecovery: { command: BatchPlanItemsCommand; failure?: 'uncertain' | 'rejected' | 'stale' } | null = null;
  let rejectBatch: ((error: unknown) => void) | null = null;
  const batchFrozen = () => batchRecovery !== null && (!batchRecovery.failure || batchRecovery.failure === 'uncertain');
  const discardable = (entry: Pending) => !entry.submitted && !batchFrozen();
  let refreshFlight: Promise<void> | null = null;
  let refreshStarted = false;
  let refreshAgain = false;
  let revisionFlight: Promise<void> | null = null;
  let deferredRefresh = false;
  let state: TimetableControllerState = { snapshot: null, draft: null, saveState: 'idle', conflicts: [], error: null,
    referenceStatus: 'unknown', recoveryAvailable: true, dirty: false, pendingOperations: [] };
  const publish = (patch: Partial<TimetableControllerState> = {}) => {
    state = { ...state, ...patch, saving: !autoSave && saveFlight !== null,
      canDiscardDraft: !autoSave && !saveFlight && pending().some(discardable),
      canUndo: !saveFlight && !batchFrozen() && (localUndo.length > 0 || lastUndo !== null) };
    for (const listener of listeners) listener();
  };
  const pending = () => [...queues.values()].flat();
  const persist = () => {
    if (!storage) { publish({ recoveryAvailable: false }); return; }
    try {
      const entries = pending().map(({ edit, submitted, status, expectedItemRevision, itemName, baseEdit }) => ({ edit, submitted, status, expectedItemRevision, itemName, baseEdit }));
      if (entries.length || batchRecovery) storage.setItem(key, JSON.stringify({ version: 1, entries, ...(!autoSave && batchRecovery ? { batch: batchRecovery } : {}) }));
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
      pendingOperations: [...queues].map(([itemId, queue]) => ({ itemId, operation: queue[0].edit.operation,
        name: queue[0].itemName || state.snapshot?.items.find(item => item.id === itemId)?.name || '삭제한 수업', failure: failureKind(itemId),
        ...(!autoSave ? { discardable: !saveFlight && queue.some(discardable) } : {}) })),
      saveState: saveState ?? (!autoSave && saveFlight ? 'saving'
        : !complete || state.referenceStatus !== 'verified' || staleItems.size > 0 ? 'stale'
        : pending().some((entry) => entry.status === 'error') ? 'error'
          : pending().length ? autoSave ? 'saving' : 'draft' : state.saveState === 'idle' ? 'idle' : 'saved'),
      error: error === undefined ? state.error : error });
  };
  const clearSensitive = () => {
    epoch += 1;
    if (!autoSave) for (const entry of pending()) entry.reject?.(Error('timetable_plan_inactive'));
    rejectBatch?.(Error('timetable_plan_inactive')); rejectBatch = null; batchRecovery = null;
    saveFlight = null; refreshFlight = null; revisionFlight = null; deferredRefresh = false;
    refreshStarted = false; refreshAgain = false; localUndo.length = 0;
    for (const controller of controllers) controller.abort();
    controllers.clear(); queues.clear(); running.clear(); staleItems.clear(); retrying.clear(); itemEpoch.clear();
    itemReceiptSequence.clear(); authoritativeReadSequence = -1; lastUndo = null;
    try { storage?.removeItem(key); } catch { /* Storage access can fail after logout. */ }
    publish({ snapshot: null, draft: null, saveState: 'idle', conflicts: [], error: null,
      referenceStatus: 'unknown', dirty: false, pendingOperations: [] });
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
        queue.push({ edit, submitted, status: submitted ? 'error' : 'queued', itemName: typeof entry.itemName === 'string' ? entry.itemName : undefined,
          baseEdit: !autoSave && isObject(entry.baseEdit) && ['save', 'delete'].includes(String(entry.baseEdit.operation))
            ? entry.baseEdit as TimetableItemEdit : undefined,
          expectedItemRevision: typeof entry.expectedItemRevision === 'number' || entry.expectedItemRevision === null
            ? entry.expectedItemRevision : undefined });
        queues.set(itemId, queue);
      }
      if (!autoSave && saved.batch !== undefined) {
        if (!isObject(saved.batch) || !isObject(saved.batch.command)) throw Error('invalid recovery');
        const command = saved.batch.command as unknown as BatchPlanItemsCommand;
        const ids = new Set<string>();
        if (command.operation !== 'save_batch' || command.planId !== planId || typeof command.requestKey !== 'string'
          || !command.requestKey.trim() || !Number.isInteger(command.expectedMetaRevision) || command.expectedMetaRevision < 0
          || !Number.isInteger(command.expectedChangeSequence) || command.expectedChangeSequence < 0
          || typeof command.expectedShadowFingerprint !== 'string' || !Array.isArray(command.edits)
          || !command.edits.length || command.edits.length > 500) throw Error('invalid recovery');
        for (const edit of command.edits) {
          const id = edit.operation === 'save' ? edit.item?.id : edit.operation === 'delete' ? edit.itemId : null;
          if (!id || ids.has(id) || !(edit.expectedItemRevision === null && edit.operation === 'save'
            || Number.isInteger(edit.expectedItemRevision) && edit.expectedItemRevision! >= 1)
            || edit.operation === 'save' && (edit.item.planId !== planId || !Array.isArray(edit.slots)
              || edit.slots.some(slot => slot.planId !== planId || slot.itemId !== id))) throw Error('invalid recovery');
          ids.add(id);
          if (!queues.has(id)) queues.set(id, [{ edit: structuredClone(edit), submitted: null, status: 'error',
            expectedItemRevision: edit.expectedItemRevision }]);
        }
        batchRecovery = { command, failure: ['rejected', 'stale'].includes(String(saved.batch.failure))
          ? saved.batch.failure as 'rejected' | 'stale' : 'uncertain' };
        for (const id of ids) for (const entry of queues.get(id)!) {
          entry.status = 'error'; entry.confirmedRejection = batchRecovery.failure === 'rejected';
          entry.confirmedStale = batchRecovery.failure === 'stale';
          if (entry.confirmedStale) staleItems.add(id);
        }
      }
    } catch { batchRecovery = null; queues.clear(); try { storage.removeItem(key); } catch { /* No recovery. */ } }
  };
  const scoped = async <T>(run: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    const token = epoch;
    const abort = new AbortController(); controllers.add(abort);
    try { const result = await run(abort.signal); return !disposed && token === epoch ? result : undefined; }
    finally { controllers.delete(abort); }
  };
  const performRefresh = async () => {
    if (paused || disposed) return;
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
      authoritativeReadSequence = next.plan.changeSequence;
      itemReceiptSequence.clear();
      for (const [id, queue] of queues) {
        if (!queue.length) continue;
        const currentRevision = next.items.find((item) => item.id === id)?.revision ?? null;
        const first = queue[0];
        const expected = !autoSave && first.expectedItemRevision !== undefined && !first.submitted
          ? first.expectedItemRevision : first.submitted?.expectedItemRevision
            ?? first.expectedItemRevision ?? old?.items.find((item) => item.id === id)?.revision ?? null;
        if (currentRevision !== expected) staleItems.add(id);
      }
      const externallyChanged = staleItems.size > 0;
      publish({ snapshot: next, referenceStatus: 'verified', error: null });
      rebuild(externallyChanged ? 'stale' : undefined);
    } catch (error) {
      if (disposed || token !== epoch || generation !== readGeneration) return;
      if (isAccessError(error)) { clearSensitive(); publish({ error, referenceStatus: 'unverifiable' }); }
      else { publish({ referenceStatus: 'unverifiable', error }); rebuild('stale', error); }
    }
  };
  const startRefresh = (): Promise<void> => {
    if (refreshFlight) return refreshFlight;
    const flight = Promise.resolve().then(() => { refreshStarted = true; return performRefresh(); });
    refreshFlight = flight;
    refreshStarted = false;
    const release = () => {
      if (refreshFlight !== flight) return;
      refreshFlight = null; refreshStarted = false;
      if (refreshAgain) { refreshAgain = false; void refresh(); }
    };
    void flight.then(release, release);
    return flight;
  };
  const refresh = (): Promise<void> => {
    if (autoSave) return performRefresh();
    if (paused || disposed) return Promise.resolve();
    if (saveFlight) { deferredRefresh = true; return Promise.resolve(); }
    if (refreshFlight) {
      // A later invalidation may postdate the in-flight database snapshot.
      // Same-tick duplicate requests share it; later signals require one reread.
      if (refreshStarted) refreshAgain = true;
      return refreshFlight;
    }
    if (revisionFlight) {
      const generation = readGeneration;
      return revisionFlight.then(() => generation === readGeneration ? refresh() : undefined);
    }
    return startRefresh();
  };
  const load = async () => {
    if (paused || disposed) return;
    if (!state.snapshot && pending().length === 0) restore();
    await refresh();
    if (state.snapshot && pending().length) rebuild(autoSave ? 'stale' : undefined);
  };
  const runQueue = (itemId: string) => {
    if (!autoSave && !saveFlight) return;
    if (running.has(itemId) || (staleItems.has(itemId) && !retrying.has(itemId)) || paused || disposed || !state.snapshot || state.referenceStatus !== 'verified') return;
    const queue = queues.get(itemId);
    if (!queue?.length || queue[0].status === 'error') return;
    running.add(itemId);
    const token = epoch;
    const generation = itemEpoch.get(itemId) ?? 0;
    void (async () => {
      try {
        while (!disposed && !paused && token === epoch && generation === (itemEpoch.get(itemId) ?? 0)
          && queue.length && queue[0].status !== 'error' && (!staleItems.has(itemId) || retrying.has(itemId))) {
          const entry = queue[0];
          const base = state.snapshot;
          if (!base || state.referenceStatus !== 'verified') break;
          if (!operatingReferenceComplete(base, periodOf(base))) { rebuild('stale'); break; }
          const revision = base.items.find((item) => item.id === itemId)?.revision ?? null;
          if (!entry.submitted && entry.expectedItemRevision !== undefined && entry.expectedItemRevision !== revision) {
            const error = Error('timetable_stale');
            entry.status = 'error'; entry.confirmedStale = true; staleItems.add(itemId); persist(); rebuild('stale', error); entry.reject?.(error); break;
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
          if (disposed || paused || token !== epoch || generation !== (itemEpoch.get(itemId) ?? 0)) {
            entry.reject?.(Error('timetable_plan_inactive')); break;
          }
          try {
            const response = await scoped((signal) => service.saveItem(submitted, { signal }));
            if (!response || token !== epoch || generation !== (itemEpoch.get(itemId) ?? 0)) break;
            if (!state.snapshot) break;
            if (receiptSuperseded(state.snapshot, response, authoritativeReadSequence, itemReceiptSequence)) {
              const error = Error('timetable_stale');
              entry.status = 'error'; entry.confirmedStale = true; staleItems.add(itemId); persist(); rebuild('stale', error);
              entry.reject?.(error); break;
            }
            const shadowChanged = response.shadowFingerprint !== state.snapshot.shadowFingerprint;
            const ownResultAlreadyVisible = receiptMatchesCurrentItem(state.snapshot, response);
            const updated = mergeReceipt(state.snapshot, response);
            for (const id of [...(response.item ? [response.item.id] : []), ...response.removedItemIds]) {
              itemReceiptSequence.set(id, Math.max(itemReceiptSequence.get(id) ?? -1, response.changeSequence));
            }
            queue.shift();
            if (ownResultAlreadyVisible) staleItems.delete(itemId);
            if (!queue.length) { queues.delete(itemId); staleItems.delete(itemId); }
            if (inverse) lastUndo = { edit: inverse, expectedItemRevision: response.item?.revision ?? null };
            publish({ snapshot: updated, error: null }); persist(); rebuild();
            entry.resolve?.();
            if (staleItems.has(itemId)) { retrying.delete(itemId); rebuild('stale'); break; }
            if (!autoSave) {
              if (shadowChanged) { deferredRefresh = true; publish({ referenceStatus: 'unverifiable' }); rebuild('stale'); }
              break;
            }
            if (shadowChanged) {
              await refresh();
              if (state.referenceStatus !== 'verified') break;
            }
          } catch (error) {
            if (disposed || token !== epoch || generation !== (itemEpoch.get(itemId) ?? 0)) break;
            if (isAccessError(error)) { clearSensitive(); publish({ error, referenceStatus: 'unverifiable' }); entry.reject?.(error); break; }
            entry.status = 'error'; entry.confirmedRejection = isConfirmedRejection(error); entry.confirmedStale = isStaleError(error); if (isStaleError(error)) staleItems.add(itemId);
            persist(); rebuild(isStaleError(error) ? 'stale' : 'error', error);
            entry.reject?.(error); break;
          }
        }
      } finally { if (generation === (itemEpoch.get(itemId) ?? 0)) { running.delete(itemId); retrying.delete(itemId); } }
    })();
  };
  const baseEditFor = (itemId: string): TimetableItemEdit => {
    const item = state.snapshot?.items.find(row => row.id === itemId);
    return item ? { operation: 'save', item: toItemDraft(item),
      slots: structuredClone(state.snapshot!.slots.filter(slot => slot.itemId === itemId)) }
      : { operation: 'delete', itemId };
  };
  const sameEdit = (left: TimetableItemEdit, right: TimetableItemEdit): boolean => {
    if (left.operation !== right.operation) return false;
    if (left.operation === 'delete') return right.operation === 'delete' && left.itemId === right.itemId;
    if (right.operation !== 'save') return false;
    const slots = (values: PlanSlot[]) => values.map(slot => JSON.stringify([slot.id, slot.planId, slot.itemId,
      slot.weekday, slot.startMinute, slot.endMinute, slot.teacherId, slot.classroomId, slot.sourceSlotId ?? null])).sort();
    return JSON.stringify(toItemDraft(left.item)) === JSON.stringify(toItemDraft(right.item))
      && JSON.stringify(slots(left.slots)) === JSON.stringify(slots(right.slots));
  };
  const stageManual = (edit: TimetableItemEdit, expectedItemRevision?: number | null) => {
    const itemId = edit.operation === 'save' ? edit.item.id : edit.itemId;
    const queue = queues.get(itemId);
    const first = queue?.[0];
    const previous = queue?.length ? structuredClone(queue[queue.length - 1]) : null;
    localUndo.push({ itemId, previous, stale: staleItems.has(itemId) });
    if (localUndo.length > 50) localUndo.shift();
    const baseEdit = first?.baseEdit ?? baseEditFor(itemId);
    const originalRevision = queue?.find(entry => entry.expectedItemRevision !== undefined)?.expectedItemRevision;
    const revision = originalRevision !== undefined ? originalRevision
      : expectedItemRevision !== undefined ? expectedItemRevision
        : state.snapshot?.items.find(row => row.id === itemId)?.revision ?? null;
    const currentRevision = state.snapshot?.items.find(row => row.id === itemId)?.revision ?? null;
    if (currentRevision !== revision) staleItems.add(itemId);
    if (currentRevision === revision && sameEdit(edit, baseEdit)) { queues.delete(itemId); staleItems.delete(itemId); }
    else queues.set(itemId, [{ edit: structuredClone(edit), submitted: null, status: 'queued', baseEdit,
      expectedItemRevision: revision, itemName: edit.operation === 'save' ? edit.item.name
        : first?.itemName ?? state.snapshot?.items.find(row => row.id === itemId)?.name }]);
    persist(); rebuild(undefined, null);
  };
  const dispatch = (edit: TimetableItemEdit, expectedItemRevision?: number | null): Promise<void> => {
    if (paused || disposed) return Promise.reject(Error('timetable_plan_inactive'));
    if (!autoSave && saveFlight) return Promise.reject(Error('timetable_save_in_progress'));
    if (!autoSave && batchFrozen()) return Promise.reject(Error('timetable_failed_edit_pending'));
    if (!state.snapshot || state.snapshot.plan.id !== planId || !state.snapshot.permissions.canEdit
      || state.snapshot.plan.state !== 'draft') return Promise.reject(Error('timetable_forbidden'));
    const itemId = edit.operation === 'save' ? edit.item.id : edit.itemId;
    if (!itemId || (edit.operation === 'save' && (edit.item.planId !== planId
      || edit.slots.some((slot) => slot.planId !== planId || slot.itemId !== itemId)))) return Promise.reject(Error('timetable_invalid'));
    if (queues.get(itemId)?.[0]?.status === 'error') return Promise.reject(Error('timetable_failed_edit_pending'));
    if (!autoSave) {
      if (queues.get(itemId)?.some(entry => entry.submitted)) return Promise.reject(Error('timetable_failed_edit_pending'));
      stageManual(edit, expectedItemRevision);
      return Promise.resolve();
    }
    let rejectSave!: (error: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => {
      rejectSave = reject;
      const queue = queues.get(itemId) ?? [];
      queue.push({ edit: structuredClone(edit), submitted: null, status: 'queued', expectedItemRevision, resolve, reject,
        itemName: edit.operation === 'save' ? edit.item.name : state.snapshot?.items.find(item => item.id === itemId)?.name });
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
  // A conclusive batch rejection committed none of its targets. Retain every
  // local intent while allowing explicit correction, reapply or cancellation.
  const abandonRejectedBatch = () => {
    if (!batchRecovery || batchFrozen()) return;
    batchRecovery = null;
    for (const [id, queue] of queues) for (const entry of queue) {
      if (entry.submitted) continue;
      entry.status = 'queued'; entry.confirmedRejection = false; entry.confirmedStale = false;
      const revision = state.snapshot?.items.find(item => item.id === id)?.revision ?? null;
      if (entry.expectedItemRevision === undefined || entry.expectedItemRevision === revision) staleItems.delete(id);
    }
  };
  const coalesceUnsent = () => {
    for (const [id, queue] of queues) {
      if (queue.some(entry => entry.submitted)) throw Error('timetable_submitted_request_pending');
      const first = queue[0], latest = queue[queue.length - 1];
      if (!first) continue;
      const originalRevision = queue.find(entry => entry.expectedItemRevision !== undefined)?.expectedItemRevision;
      const expectedItemRevision = originalRevision !== undefined ? originalRevision
        : state.snapshot?.items.find(item => item.id === id)?.revision ?? null;
      const baseEdit = first.baseEdit ?? latest.baseEdit ?? baseEditFor(id);
      const currentRevision = state.snapshot?.items.find(item => item.id === id)?.revision ?? null;
      if (currentRevision === expectedItemRevision && sameEdit(latest.edit, baseEdit)) {
        queues.delete(id); staleItems.delete(id);
      } else queues.set(id, [{ ...latest, expectedItemRevision, baseEdit }]);
    }
    persist(); rebuild();
  };
  const sendBatch = async (token: number) => {
    if (!batchRecovery && !queues.size) return;
    if (!service.saveBatch) throw Error('timetable_batch_rpc_unavailable');
    if (!batchRecovery) {
      coalesceUnsent();
      if (!queues.size) return;
      const base = state.snapshot;
      if (!base || state.referenceStatus !== 'verified' || !operatingReferenceComplete(base, periodOf(base))) throw Error('timetable_reference_unverifiable');
      const edits: BatchPlanItemsCommand['edits'] = [];
      for (const [id, queue] of queues) {
        const entry = queue[0], revision = base.items.find(item => item.id === id)?.revision ?? null;
        if (staleItems.has(id) || entry.confirmedStale || entry.expectedItemRevision !== revision) {
          entry.status = 'error'; entry.confirmedStale = true; staleItems.add(id);
          persist(); rebuild('stale', Error('timetable_stale')); throw Error('timetable_stale');
        }
        if (entry.confirmedRejection) throw Error('timetable_rejection_required');
        if (entry.edit.operation === 'save') edits.push({ operation: 'save', item: toItemDraft(entry.edit.item),
          expectedItemRevision: entry.expectedItemRevision!, slots: structuredClone(entry.edit.slots) });
        else {
          if (entry.expectedItemRevision === null) throw Error('timetable_stale');
          edits.push({ operation: 'delete', itemId: id, expectedItemRevision: entry.expectedItemRevision! });
        }
      }
      batchRecovery = { command: { operation: 'save_batch', planId, expectedMetaRevision: base.plan.metaRevision,
        expectedChangeSequence: base.plan.changeSequence, expectedShadowFingerprint: base.shadowFingerprint,
        requestKey: requestKey(), edits } };
    } else if (batchRecovery.failure === 'stale') throw Error('timetable_stale');
    else if (batchRecovery.failure === 'rejected') throw Error('timetable_rejection_required');
    const command = structuredClone(batchRecovery.command);
    batchRecovery.failure = undefined;
    for (const entry of pending()) entry.status = 'sending';
    localUndo.length = 0;
    persist(); rebuild('saving');
    // A subscriber can revoke access synchronously when the submitted state is published.
    if (paused || disposed || token !== epoch) throw Error('timetable_plan_inactive');
    try {
      const response = await new Promise<BatchSaveResult | undefined>((resolve, reject) => {
        rejectBatch = reject;
        void scoped(signal => service.saveBatch!(command, { signal })).then(resolve, reject);
      });
      if (!response || paused || disposed || token !== epoch) throw Error('timetable_plan_inactive');
      const receipt = requireTimetableBatchResult(response, command);
      const base = state.snapshot;
      if (!base) throw Error('timetable_plan_inactive');
      const inverse = command.edits.length === 1 ? queues.get(command.edits[0].operation === 'save'
        ? command.edits[0].item.id : command.edits[0].itemId)?.[0]?.baseEdit : undefined;
      for (const ack of receipt.acknowledgements) {
        queues.delete(ack.itemId); staleItems.delete(ack.itemId); retrying.delete(ack.itemId);
        itemReceiptSequence.set(ack.itemId, Math.max(itemReceiptSequence.get(ack.itemId) ?? -1, receipt.committedChangeSequence));
      }
      lastUndo = inverse ? { edit: structuredClone(inverse), expectedItemRevision: receipt.acknowledgements[0].itemRevision } : null;
      batchRecovery = null;
      // A retry returns the immutable commit snapshot. A later authorized read
      // already owns the canonical state; the receipt only resolves our intent.
      const newer = base.plan.changeSequence > receipt.snapshot.plan.changeSequence
        || base.plan.changeSequence === receipt.snapshot.plan.changeSequence && base.plan.metaRevision >= receipt.snapshot.plan.metaRevision;
      if (!newer) authoritativeReadSequence = receipt.snapshot.plan.changeSequence;
      publish({ snapshot: newer ? base : receipt.snapshot, referenceStatus: 'verified', error: null });
      persist(); rebuild();
    } catch (error) {
      if (paused || disposed || token !== epoch) throw Error('timetable_plan_inactive');
      if (isAccessError(error)) { clearSensitive(); publish({ error, referenceStatus: 'unverifiable' }); throw error; }
      const missingFunction = ['PGRST202', '42883'].includes(String((error as { code?: string } | null)?.code));
      if (batchRecovery) batchRecovery.failure = isStaleError(error) ? 'stale'
        : isConfirmedRejection(error) || missingFunction ? 'rejected' : 'uncertain';
      for (const [id, queue] of queues) for (const entry of queue) {
        entry.status = 'error'; entry.confirmedStale = batchRecovery?.failure === 'stale';
        entry.confirmedRejection = batchRecovery?.failure === 'rejected';
        if (entry.confirmedStale) staleItems.add(id);
      }
      persist(); rebuild(isStaleError(error) ? 'stale' : 'error', error);
      throw error;
    } finally { if (token === epoch) rejectBatch = null; }
  };
  const saveManual = (targets: string[], drainDrafts = false): Promise<void> => {
    if (saveFlight) return saveFlight;
    if (paused || disposed) return Promise.reject(Error('timetable_plan_inactive'));
    const token = epoch;
    const run = async () => {
      if (paused || disposed || token !== epoch) throw Error('timetable_plan_inactive');
      if (!batchRecovery && (!state.snapshot?.permissions.canEdit || state.snapshot.plan.state !== 'draft')) throw Error('timetable_forbidden');
      if (refreshFlight || revisionFlight) deferredRefresh = true;
      refreshFlight = null; revisionFlight = null; refreshStarted = false; refreshAgain = false; readGeneration++;
      if (batchRecovery) { await sendBatch(token); return; }
      if (!state.snapshot) throw Error('timetable_forbidden');
      // Old autosave recovery receipts remain exact single-item requests. Never
      // include their unchanged acknowledged heads in the new batch.
      for (const id of targets) {
        while (queues.get(id)?.[0]?.submitted) {
          if (paused || disposed || token !== epoch) throw Error('timetable_plan_inactive');
          const entry = queues.get(id)![0];
          if (state.referenceStatus !== 'verified' || !operatingReferenceComplete(state.snapshot, periodOf(state.snapshot))) throw Error('timetable_reference_unverifiable');
          if (entry.confirmedStale) throw Error('timetable_stale');
          if (entry.confirmedRejection) throw Error('timetable_rejection_required');
          if (staleItems.has(id)) retrying.add(id);
          entry.status = 'queued'; localUndo.length = 0;
          await new Promise<void>((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; runQueue(id); });
          if (!drainDrafts) break;
        }
      }
      if (drainDrafts) {
        if (paused || disposed || token !== epoch) throw Error('timetable_plan_inactive');
        await sendBatch(token);
      }
    };
    const flight = Promise.resolve().then(run);
    saveFlight = flight;
    rebuild();
    const finish = () => {
      if (saveFlight !== flight) return;
      saveFlight = null;
      if (!paused && !disposed && token === epoch) {
        persist(); rebuild();
        if (deferredRefresh) { deferredRefresh = false; void refresh(); }
      }
    };
    void flight.then(finish, finish);
    return flight;
  };
  const saveDraft = (): Promise<void> => autoSave ? retry() : saveManual([...queues.keys()], true);
  const discardDraft = async (): Promise<void> => {
    if (paused || disposed) throw Error('timetable_plan_inactive');
    if (saveFlight) throw Error('timetable_save_in_progress');
    if (batchFrozen()) throw Error('timetable_submitted_request_pending');
    abandonRejectedBatch();
    if (!pending().some(discardable)) {
      if (pending().length) throw Error('timetable_submitted_request_pending');
      return;
    }
    for (const [id, queue] of queues) {
      const submitted = queue.filter(entry => entry.submitted);
      if (submitted.length) queues.set(id, submitted);
      else { queues.delete(id); staleItems.delete(id); }
    }
    localUndo.length = 0;
    persist(); rebuild(undefined, pending().length ? undefined : null);
  };
  function failureKind(itemId: string): 'rejected' | 'uncertain' | 'stale' | null {
    if (batchRecovery?.command.edits.some(edit => (edit.operation === 'save' ? edit.item.id : edit.itemId) === itemId))
      return batchRecovery.failure ?? null;
    const head = queues.get(itemId)?.[0];
    // A newer snapshot cannot tell whether our submitted command committed.
    // Only its server response (or a superseded receipt) authorizes abandonment.
    if (head?.submitted && !head.confirmedStale && !head.confirmedRejection)
      return head.status === 'error' || staleItems.has(itemId) ? 'uncertain' : null;
    if (head?.confirmedStale || staleItems.has(itemId)) return 'stale';
    return head?.status === 'error' ? head.confirmedRejection ? 'rejected' : 'uncertain' : null;
  }
  // Replace only a conclusively rejected head. Newer queued intents and other items stay intact.
  const replaceRejected = (edit: TimetableItemEdit): Promise<void> => {
    if (paused || disposed) return Promise.reject(Error('timetable_plan_inactive'));
    if (!autoSave && saveFlight) return Promise.reject(Error('timetable_save_in_progress'));
    const itemId = edit.operation === 'save' ? edit.item.id : edit.itemId;
    if (failureKind(itemId) !== 'rejected') return Promise.reject(Error('timetable_rejection_required'));
    if (!state.snapshot?.permissions.canEdit || state.snapshot.plan.state !== 'draft') return Promise.reject(Error('timetable_forbidden'));
    if (edit.operation === 'save' && (edit.item.planId !== planId || edit.slots.some(slot => slot.planId !== planId || slot.itemId !== itemId))) return Promise.reject(Error('timetable_invalid'));
    if (state.referenceStatus !== 'verified' || !operatingReferenceComplete(state.snapshot, periodOf(state.snapshot))) return Promise.reject(Error('timetable_reference_unverifiable'));
    const queue = queues.get(itemId)!;
    if (!autoSave) {
      const rejected = queue[0];
      abandonRejectedBatch();
      queues.delete(itemId);
      const revision = rejected.expectedItemRevision !== undefined ? rejected.expectedItemRevision : rejected.submitted?.expectedItemRevision;
      stageManual(edit, revision);
      return Promise.resolve();
    }
    queue.shift();
    const promise = new Promise<void>((resolve, reject) => {
      queue.unshift({ edit: structuredClone(edit), submitted: null, status: 'queued', resolve, reject });
    });
    persist(); rebuild(); runQueue(itemId);
    return promise;
  };
  const discardRejected = async (itemId: string): Promise<void> => {
    if (paused || disposed) throw Error('timetable_plan_inactive');
    if (!autoSave && saveFlight) throw Error('timetable_save_in_progress');
    if (failureKind(itemId) !== 'rejected') throw Error('timetable_rejection_required');
    abandonRejectedBatch();
    const queue = queues.get(itemId)!;
    queue.shift(); if (!queue.length) queues.delete(itemId);
    persist(); rebuild(undefined, null); if (autoSave) runQueue(itemId);
  };
  const undo = (): Promise<void> => {
    if (paused || disposed) return Promise.reject(Error('timetable_plan_inactive'));
    if (!autoSave && saveFlight) return Promise.reject(Error('timetable_save_in_progress'));
    if (!autoSave && batchFrozen()) return Promise.reject(Error('timetable_submitted_request_pending'));
    if (!autoSave && localUndo.length) {
      const inverse = localUndo[localUndo.length - 1];
      if (queues.get(inverse.itemId)?.some(entry => entry.submitted)) return Promise.reject(Error('timetable_submitted_request_pending'));
      localUndo.pop();
      if (inverse.previous) queues.set(inverse.itemId, [inverse.previous]); else queues.delete(inverse.itemId);
      const currentRevision = state.snapshot?.items.find(row => row.id === inverse.itemId)?.revision ?? null;
      if (inverse.previous && (inverse.stale || (inverse.previous.expectedItemRevision !== undefined
        && inverse.previous.expectedItemRevision !== currentRevision))) staleItems.add(inverse.itemId);
      else staleItems.delete(inverse.itemId);
      persist(); rebuild(undefined, null);
      return Promise.resolve();
    }
    if (!lastUndo) return Promise.reject(Error('timetable_undo_unavailable'));
    const inverse = structuredClone(lastUndo);
    lastUndo = null;
    return dispatch(inverse.edit, inverse.expectedItemRevision);
  };
  const retry = (itemId?: string): Promise<void> => {
    if (paused || disposed) return Promise.reject(Error('timetable_plan_inactive'));
    if (!autoSave) {
      if (saveFlight) return saveFlight;
      if (batchRecovery) return saveManual([]);
      return saveManual((itemId ? [itemId] : [...queues.keys()]).filter(id => !!queues.get(id)?.[0]?.submitted));
    }
    return (async () => {
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
    })();
  };
  const resolveStale = (itemId: string, choice: 'accept_server' | 'reapply_draft'): Promise<void> => {
    if (paused || disposed) return Promise.reject(Error('timetable_plan_inactive'));
    if (!autoSave && saveFlight) return Promise.reject(Error('timetable_save_in_progress'));
    if (failureKind(itemId) !== 'stale' || !state.snapshot || !state.draft) return Promise.reject(Error('timetable_stale_resolution_unavailable'));
    if (!autoSave) abandonRejectedBatch();
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
  const performRevisionCheck = async () => {
    if (disposed || paused || !state.snapshot) return;
    const token = epoch;
    const generation = readGeneration;
    try {
      const revision = await scoped((signal) => service.readRevision(planId, { signal }));
      if (!revision || !state.snapshot || token !== epoch || (!autoSave && generation !== readGeneration)) return;
      if (revision.planId !== planId) throw new Error('timetable_plan_response_invalid');
      if (revision.changeSequence !== state.snapshot.plan.changeSequence
        || revision.metaRevision !== state.snapshot.plan.metaRevision
        || revision.shadowFingerprint !== state.snapshot.shadowFingerprint
        || revision.complete !== state.snapshot.complete) await (autoSave ? refresh() : startRefresh());
    } catch (error) {
      if (disposed || token !== epoch || (!autoSave && generation !== readGeneration)) return;
      if (isAccessError(error)) { clearSensitive(); publish({ error, referenceStatus: 'unverifiable' }); }
      else { publish({ referenceStatus: 'unverifiable', error }); rebuild('stale', error); }
    }
  };
  const checkRevision = (): Promise<void> => {
    if (autoSave) return performRevisionCheck();
    if (paused || disposed || !state.snapshot) return Promise.resolve();
    if (saveFlight) { deferredRefresh = true; return Promise.resolve(); }
    if (refreshFlight) return refreshFlight;
    if (revisionFlight) return revisionFlight;
    const flight = Promise.resolve().then(performRevisionCheck);
    revisionFlight = flight;
    const release = () => { if (revisionFlight === flight) revisionFlight = null; };
    void flight.then(release, release);
    return flight;
  };
  const applyTransfer = (result: TransferResult) => {
    if (paused || disposed) throw Error('timetable_plan_inactive');
    const base = state.snapshot;
    if (base) requireTimetableTransferResult(result, planId);
    if (!base) return;
    // Retire reads started before this receipt. Plan-only copies do not advance
    // the source sequence; equality cannot order two operating fingerprints.
    readGeneration++;
    const incomingPlan = result.snapshot?.plan ?? result.sourcePlan;
    if (incomingPlan?.changeSequence === base.plan.changeSequence && result.shadowFingerprint !== base.shadowFingerprint) {
      publish({ referenceStatus: 'unverifiable' }); rebuild('stale'); return;
    }
    if (result.snapshot) {
      if (result.snapshot.plan.id !== planId || result.snapshot.plan.changeSequence < base.plan.changeSequence) return;
      authoritativeReadSequence = result.snapshot.plan.changeSequence; itemReceiptSequence.clear();
      publish({ snapshot: result.snapshot, referenceStatus: 'unverifiable', error: null }); rebuild(); return;
    }
    if (!result.addedShadowClasses || !result.sourcePlan || !result.operatingReference
      || result.sourcePlan.id !== planId || result.sourcePlan.changeSequence < base.plan.changeSequence
      || result.operatingReference.shadowFingerprint !== result.shadowFingerprint) throw Error('timetable_plan_response_invalid');
    for (const applied of result.appliedItems) {
      const source = base.items.find((item) => item.id === applied.id);
      if (!source || (source.state !== 'draft' && source.appliedTransferId !== result.transferId)
        || applied.revision < source.revision) throw Error('timetable_plan_response_invalid');
    }
    const next = structuredClone(base);
    for (const applied of result.appliedItems) {
      const priorSlots = next.slots.filter((slot) => slot.itemId === applied.id);
      if (priorSlots.length) next.appliedSnapshots = [...next.appliedSnapshots.filter((entry) => entry.itemId !== applied.id),
        { itemId: applied.id, slots: priorSlots }];
    }
    next.items = [...next.items.filter((item) => !result.removedItemIds.includes(item.id)
      && !result.appliedItems.some((applied) => applied.id === item.id)), ...result.appliedItems,
      ...result.createdItems.filter((item) => item.planId === planId)];
    next.slots = [...next.slots.filter((slot) => !result.removedItemIds.includes(slot.itemId)
      && !result.appliedItems.some((applied) => applied.id === slot.itemId)),
      ...result.createdSlots.filter((slot) => slot.planId === planId)];
    next.plan = result.sourcePlan;
    for (const id of [...result.appliedItems.map((applied) => applied.id), ...result.removedItemIds]) {
      itemReceiptSequence.set(id, Math.max(itemReceiptSequence.get(id) ?? -1, result.sourcePlan.changeSequence));
    }
    Object.assign(next, result.operatingReference);
    next.capacity.itemCount = next.items.length;
    next.capacity.slotCount = next.slots.length;
    publish({ snapshot: next, referenceStatus: 'unverifiable', error: null }); rebuild();
  };
  return { snapshot: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load, refresh, checkRevision, dispatch, saveDraft, discardDraft, undo, retry, resolveStale, failureKind, replaceRejected, discardRejected, applyTransfer, clearSensitive,
    pause: () => {
      if (disposed || paused) return;
      paused = true; epoch += 1;
      if (!autoSave) for (const entry of pending()) entry.reject?.(Error('timetable_plan_inactive'));
      rejectBatch?.(Error('timetable_plan_inactive')); rejectBatch = null;
      if (batchRecovery && !batchRecovery.failure) batchRecovery.failure = 'uncertain';
      saveFlight = null; refreshFlight = null; revisionFlight = null; deferredRefresh = false; refreshStarted = false; refreshAgain = false;
      for (const controller of controllers) controller.abort();
      controllers.clear();
      for (const [id, queue] of queues) {
        itemEpoch.set(id, (itemEpoch.get(id) ?? 0) + 1);
        for (const entry of queue) if (entry.status === 'sending') entry.status = 'error';
      }
      // The submitted identity was persisted before the request. Cleanup must never
      // recreate a key already purged by AuthProvider during logout.
      running.clear(); retrying.clear(); rebuild(pending().length ? 'stale' : undefined);
    },
    resume: () => { if (disposed) throw Error('timetable_plan_inactive'); paused = false; },
    destroy: () => {
      disposed = true; paused = true; epoch += 1;
      if (!autoSave) for (const entry of pending()) entry.reject?.(Error('timetable_plan_inactive'));
      rejectBatch?.(Error('timetable_plan_inactive')); rejectBatch = null;
      if (batchRecovery && !batchRecovery.failure) batchRecovery.failure = 'uncertain';
      saveFlight = null; refreshFlight = null; revisionFlight = null; deferredRefresh = false; refreshStarted = false; refreshAgain = false;
      for (const controller of controllers) controller.abort(); controllers.clear(); listeners.clear();
    } };
}
