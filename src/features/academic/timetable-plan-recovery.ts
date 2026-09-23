export type TimetableDraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type IndexedStorage = TimetableDraftStorage & Pick<Storage, 'length' | 'key'>;
const activeActorListeners = new Map<string, Set<() => void>>();
/** Active editors retire synchronously when the auth owner clears this scope. */
export function observeTimetableActorRetirement(actorScope: string, listener: () => void): () => void {
  const listeners = activeActorListeners.get(actorScope) ?? new Set<() => void>();
  listeners.add(listener); activeActorListeners.set(actorScope, listeners);
  return () => { listeners.delete(listener); if (!listeners.size) activeActorListeners.delete(actorScope); };
}
export function availableTimetableSessionStorage(): IndexedStorage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; }
  catch { return null; }
}
export const timetableDraftStorageKey = (actorScope: string, planId: string) =>
  `tips:timetable:draft:v1:${encodeURIComponent(actorScope)}:${encodeURIComponent(planId)}`;
/** Logout or actor/role change removes drafts for every previously visited plan in this actor scope. */
export function clearTimetableActorRecovery(actorScope: string, storage: IndexedStorage | null = availableTimetableSessionStorage()): void {
  if (!actorScope) return;
  for (const listener of [...(activeActorListeners.get(actorScope) ?? [])]) listener();
  if (!storage) return;
  const prefix = `tips:timetable:draft:v1:${encodeURIComponent(actorScope)}:`;
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) storage.removeItem(key);
    }
  } catch { /* Storage may be unavailable after auth changes. */ }
}

const planRevocationListeners = new Map<string, Set<(planId: string) => void>>();
export function observeTimetablePlanRevocation(actorScope: string, listener: (planId: string) => void): () => void {
  const listeners = planRevocationListeners.get(actorScope) ?? new Set<(planId: string) => void>();
  listeners.add(listener); planRevocationListeners.set(actorScope, listeners);
  return () => { listeners.delete(listener); if (!listeners.size) planRevocationListeners.delete(actorScope); };
}
/** A share revocation must not retire this actor's other permitted plans. */
export function clearTimetablePlanRecovery(actorScope: string, planId: string, storage: IndexedStorage | null = availableTimetableSessionStorage()): void {
  if (!actorScope || !planId) return;
  for (const listener of [...(planRevocationListeners.get(actorScope) ?? [])]) listener(planId);
  if (!storage) return;
  const planKey = timetableDraftStorageKey(actorScope, planId);
  const metadataKey = timetableDraftStorageKey(actorScope, '$metadata');
  const prefix = `tips:timetable:draft:v1:${encodeURIComponent(actorScope)}:`;
  try {
    storage.removeItem(planKey); storage.removeItem(`${planKey}:transfer`);
    const raw = storage.getItem(metadataKey);
    if (raw) {
      try {
        const command = JSON.parse(raw)?.pending?.command;
        if (command?.planId === planId || command?.sourcePlanId === planId) storage.removeItem(metadataKey);
      } catch { /* Unrelated malformed recovery is handled by its owner. */ }
    }
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix) || !key.endsWith(':transfer')) continue;
      try {
        const request = JSON.parse(storage.getItem(key) ?? '{}')?.request;
        if (request?.source?.planId === planId || request?.target?.planId === planId) storage.removeItem(key);
      } catch { /* Do not discard another plan's unrelated request. */ }
    }
  } catch { /* Storage can become unavailable independently of permission changes. */ }
}
