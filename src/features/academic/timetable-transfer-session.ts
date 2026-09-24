import type { TransferCommitCommand, TransferPreview, TransferRequest, TransferResult } from './timetable-plan-contract.ts';
import type { TimetablePlanService } from './timetable-plan-service.ts';
import { availableTimetableSessionStorage, timetableDraftStorageKey, type TimetableDraftStorage } from './timetable-plan-recovery.ts';
export type TransferState = {
  status: 'idle' | 'previewing' | 'ready' | 'committing' | 'uncertain' | 'rejected' | 'refreshing' | 'refresh_failed' | 'completed';
  preview: TransferPreview | null; command: TransferCommitCommand | null; result: TransferResult | null; error: unknown;
};
export function transferWasRejected(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error) || !('message' in error)) return false;
  return (error.code === 'P0001' && error.message === 'timetable_stale')
    || (error.code === '23P01' && error.message === 'timetable_resource_conflict')
    || (error.code === '22023' && ['timetable_invalid','timetable_capacity'].includes(String(error.message)))
    || (error.code === '42501' && error.message === 'timetable_forbidden');
}
/** One immutable commit intent, durable until its receipt and coherent read agree. */
export function createTimetableTransferSession({ service, planId, apply, refresh, afterCommit, onForbidden = () => {}, storage = availableTimetableSessionStorage() }: {
  service: Pick<TimetablePlanService, 'actorScope' | 'previewTransfer' | 'commitTransfer'>; planId: string;
  apply: (result: TransferResult) => void; refresh: () => Promise<void>;
  afterCommit: (result: TransferResult, request: TransferRequest) => Promise<void>;
  onForbidden?: () => void;
  storage?: TimetableDraftStorage | null;
}) {
  const key = `${timetableDraftStorageKey(service.actorScope, planId)}:transfer`;
  let state: TransferState = { status: 'idle', preview: null, command: null, result: null, error: null };
  let active = true, generation = 0;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<TransferState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const persist = () => { try { if (state.command) storage?.setItem(key, JSON.stringify(state.command)); else storage?.removeItem(key); } catch { /* In-memory command still owns retry. */ } };
  try {
    const raw = storage?.getItem(key);
    if (raw) {
      const command = JSON.parse(raw) as TransferCommitCommand;
      if (command.request.source.planId === planId && command.requestKey && command.previewFingerprint) state = { ...state, status: 'uncertain', command };
    }
  } catch { /* Corrupt local data is never sent automatically. */ }
  const refreshCommitted = async () => {
    if (!active || !state.result || !state.command) return;
    const token = ++generation;
    publish({ status: 'refreshing', error: null });
    try {
      await afterCommit(state.result, state.command.request);
      await refresh();
      if (!active || token !== generation) return;
      publish({ status: 'completed', command: null }); persist();
    } catch (error) {
      if (active && token === generation) publish({ status: 'refresh_failed', error });
    }
  };
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    resume: () => { active = true; },
    pause: () => { active = false; generation++; },
    retire: () => { active = false; generation++; state = { status: 'idle', preview: null, command: null, result: null, error: null }; persist(); },
    reset: () => { if (state.command) return; generation++; publish({ status: 'idle', preview: null, result: null, error: null }); },
    preview: async (request: TransferRequest) => {
      if (!active || state.command) return;
      const token = ++generation;
      publish({ status: 'previewing', preview: null, result: null, error: null });
      try {
        const preview = await service.previewTransfer(structuredClone(request));
        if (active && token === generation) publish({ status: 'ready', preview });
      } catch (error) { if (active && token === generation) { publish({ status: 'rejected', error }); if (isForbidden(error)) onForbidden(); } }
    },
    commit: async () => {
      if (!active || ['committing','refreshing'].includes(state.status)) return;
      if (state.result) return refreshCommitted();
      if (!state.command) {
        if (!state.preview || state.preview.blockers.length) return;
        publish({ command: { request: structuredClone(state.preview.request), previewFingerprint: state.preview.fingerprint, requestKey: crypto.randomUUID() } });
        persist(); // Written before the request can reach the server.
      }
      const token = ++generation;
      publish({ status: 'committing', error: null });
      try {
        const result = await service.commitTransfer(structuredClone(state.command!));
        if (!active || token !== generation) return;
        publish({ result });
        // Applying a receipt and refreshing a cache cannot turn a committed
        // transaction into a failed transfer or allocate a second request key.
        try { apply(result); } catch (error) { publish({ status: 'refresh_failed', error }); return; }
        await refreshCommitted();
      } catch (error) {
        if (!active || token !== generation) return;
        if (transferWasRejected(error)) {
          publish({ status: 'rejected', command: null, preview: null, error }); persist();
          if (isForbidden(error)) onForbidden();
        } else publish({ status: 'uncertain', error });
      }
    },
    refreshCommitted,
  };
}
export function transferEffect(request: TransferRequest) {
  const count = request.itemIds.length;
  if (request.target.kind === 'operational') return `새 수업 ${count}개를 수강에 만들고 ${request.mode === 'copy' ? '원안은 반영 완료로 보관' : '프리셋에서 이동'}`;
  return `다른 프리셋에 새 초안 ${count}개를 만들고 ${request.mode === 'copy' ? '원안 유지' : '원안에서 이동'}`;
}

const isForbidden = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === '42501';
