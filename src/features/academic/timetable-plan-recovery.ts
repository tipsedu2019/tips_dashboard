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
/** Logout/revocation removes drafts for every previously visited plan in this actor scope. */
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
