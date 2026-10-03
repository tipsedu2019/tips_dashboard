import { type AiRequestActor } from './ai-agent-request-access';
import { createAiAgentRequestAttempt } from './ai-agent-request-attempt';

// Drafts and uncertain receipt identities share a lifetime. Navigation can
// replace components; only an authoritative actor/session change discards them.
const drafts = new Map<string, unknown>();
const attempts = new Map<string, unknown>();
let activeActorKey: string | null = null;
let recoveryRevision = 0;
const listeners = new Set<() => void>();

export function subscribeAiRequestRecovery(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getAiRequestRecoveryRevision() {
  return recoveryRevision;
}

function notifyActorChange() {
  recoveryRevision += 1;
  listeners.forEach(listener => listener());
}

function actorKey(actor: AiRequestActor) {
  return `${actor.userId}:${actor.role}`;
}

function scopedKey(actor: AiRequestActor, scope: string) {
  return `${actorKey(actor)}:${scope}`;
}

export function synchronizeAiRequestRecoveryActor(actor: AiRequestActor | null) {
  const nextKey = actor ? actorKey(actor) : null;
  const changed = activeActorKey !== nextKey;
  if (changed) {
    drafts.clear();
    attempts.clear();
  }
  activeActorKey = nextKey;
  if (changed) notifyActorChange();
  return changed;
}

export function discardAiRequestRecovery() {
  drafts.clear();
  attempts.clear();
  activeActorKey = null;
  notifyActorChange();
}

export function readAiRequestDraft<T>(actor: AiRequestActor, scope: string) {
  return drafts.get(scopedKey(actor, scope)) as T | undefined;
}

export function writeAiRequestDraft<T>(actor: AiRequestActor, scope: string, draft: T) {
  drafts.set(scopedKey(actor, scope), structuredClone(draft));
}

export function deleteAiRequestDraft(actor: AiRequestActor, scope: string) {
  drafts.delete(scopedKey(actor, scope));
}

export function getAiRequestAttempt<T>(actor: AiRequestActor, scope: string) {
  const key = scopedKey(actor, scope);
  if (!attempts.has(key)) attempts.set(key, createAiAgentRequestAttempt<T>());
  return attempts.get(key) as ReturnType<typeof createAiAgentRequestAttempt<T>>;
}
