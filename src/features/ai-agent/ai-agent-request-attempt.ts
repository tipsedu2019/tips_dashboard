import { AiRequestServiceError } from './ai-agent-request-service';

/** Preserve the exact submitted payload and key when a receipt is uncertain. */
export function createAiAgentRequestAttempt<T>() {
  let pending: { payload: T; key: string } | null = null;
  let busy = false;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());

  return {
    get busy() { return busy; },
    get pending() { return pending; },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async submit<R>(payload: T, send: (payload: T, key: string) => Promise<R>) {
      if (busy) return null;
      pending ??= { payload: structuredClone(payload), key: crypto.randomUUID() };
      const submitted = pending;
      busy = true;
      notify();
      try {
        const receipt = await send(submitted.payload, submitted.key);
        pending = null;
        return { receipt, submitted: submitted.payload };
      } catch (error) {
        if (error instanceof AiRequestServiceError && error.definite) pending = null;
        throw error;
      } finally {
        busy = false;
        notify();
      }
    },
  };
}
