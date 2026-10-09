import { z } from "zod";

// Strict producer/consumer boundary. No credential secrets are persisted.
const uuid = z.uuid();
const date = z.iso.datetime({ offset: true });
const target = z.object({ id: uuid, name: z.string().min(1).max(500) }).strict();
const targets = z.array(target).max(50).refine(rows => new Set(rows.map(row => row.id)).size === rows.length);
export const personalConnectionSchema = z.object({
  id: uuid, ownerId: uuid, label: z.string().min(1).max(80),
  classes: targets, schools: targets, expiresAt: date, revokedAt: date.nullable(), lastUsedAt: date.nullable(),
}).strict().refine(row => row.classes.length + row.schools.length > 0);
const pendingSchema = z.object({ requestId: uuid, kind: z.enum(["issue", "revoke"]) }).strict();
export type PendingPersonalOperation = z.infer<typeof pendingSchema>;
export type PersonalConnection = z.infer<typeof personalConnectionSchema>;
export type PersonalTarget = z.infer<typeof target>;
export const personalSnapshotSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unavailable") }).strict(),
  z.object({
    status: z.literal("ready"), ownerId: uuid,
    items: z.array(personalConnectionSchema).max(20), total: z.number().int().nonnegative(),
    page: z.number().int().min(1), pageSize: z.union([z.literal(10), z.literal(15), z.literal(20)]),
    operation: pendingSchema.extend({ state: z.enum(["unknown", "applied", "failed"]), credential: personalConnectionSchema.nullable() }).strict().nullable(),
  }).strict(),
]);
export type PersonalSnapshot = z.infer<typeof personalSnapshotSchema>;
export type ReadyPersonalSnapshot = Extract<PersonalSnapshot, { status: "ready" }>;
export type PersonalIssueInput = { requestId: string; label: string; expiresAt: string; classIds: string[]; schoolIds: string[] };
export interface PersonalConnectionService {
  load(input: { page: number; pageSize: 10 | 15 | 20; pending: PendingPersonalOperation | null; signal: AbortSignal }): Promise<unknown>;
  targets(input: { kind: "classes" | "schools"; search: string; page: number; pageSize: 10 | 15 | 20; signal: AbortSignal }): Promise<unknown>;
  issue(input: PersonalIssueInput): Promise<unknown>;
  revoke(input: { requestId: string; credentialId: string }): Promise<unknown>;
}
export const personalTargetsSchema = z.object({
  ownerId: uuid, kind: z.enum(["classes", "schools"]), search: z.string().max(100),
  items: z.array(target).max(20), total: z.number().int().nonnegative(),
  page: z.number().int().min(1), pageSize: z.union([z.literal(10), z.literal(15), z.literal(20)]),
}).strict();
export function parsePersonalTargets(raw: unknown, ownerId: string, input: { kind: string; search: string; page: number; pageSize: number }) {
  const result = personalTargetsSchema.parse(raw);
  if (result.ownerId !== ownerId || result.kind !== input.kind || result.search !== input.search.trim()
    || result.page !== input.page || result.pageSize !== input.pageSize
    || new Set(result.items.map(row => row.id)).size !== result.items.length
    || result.items.length !== Math.min(input.pageSize, Math.max(0, result.total - (input.page - 1) * input.pageSize))) throw new Error("personal_targets_invalid");
  return result;
}
export function parsePersonalSnapshot(raw: unknown, ownerId: string, page: number, pageSize: number, pending: PendingPersonalOperation | null): PersonalSnapshot {
  const result = personalSnapshotSchema.parse(raw);
  if (result.status === "ready" && (result.ownerId !== ownerId || result.items.some(row => row.ownerId !== ownerId)
    || result.page !== page || result.pageSize !== pageSize || new Set(result.items.map(row => row.id)).size !== result.items.length
    || result.items.length !== Math.min(pageSize, Math.max(0, result.total - (page - 1) * pageSize))
    || Boolean(pending) !== Boolean(result.operation)
    || (result.operation && (!pending || result.operation.requestId !== pending.requestId || result.operation.kind !== pending.kind
      || (result.operation.state === "applied") !== Boolean(result.operation.credential)
      || (result.operation.credential && result.operation.credential.ownerId !== ownerId))))) {
    throw new Error("personal_snapshot_invalid");
  }
  return result;
}
export function parsePersonalIssue(raw: unknown, ownerId: string, input: PersonalIssueInput) {
  const result = z.object({ requestId: uuid, credential: personalConnectionSchema, secret: z.string().regex(/^tips_dashboard_personal_[a-f0-9]{64}$/) }).strict().parse(raw);
  const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  if (result.requestId !== input.requestId || result.credential.ownerId !== ownerId || result.credential.revokedAt !== null
    || result.credential.label !== input.label || Date.parse(result.credential.expiresAt) !== Date.parse(input.expiresAt)
    || !same(result.credential.classes.map(row => row.id), input.classIds) || !same(result.credential.schools.map(row => row.id), input.schoolIds)) throw new Error("personal_issue_invalid");
  return result;
}
export function parsePersonalRevoke(raw: unknown, ownerId: string, requestId: string, credentialId: string) {
  const result = z.object({ requestId: uuid, credential: personalConnectionSchema }).strict().parse(raw);
  if (result.requestId !== requestId || result.credential.id !== credentialId || result.credential.ownerId !== ownerId || !result.credential.revokedAt) throw new Error("personal_revoke_invalid");
  return result;
}
// Only correlation metadata persists; no label, selected targets, token or hash.
const recoveryKey = (ownerId: string) => `tips:personal-connection:pending:${ownerId}`;
export function readPersonalPending(storage: Pick<Storage, "getItem">, ownerId: string): PendingPersonalOperation | null {
  const raw = storage.getItem(recoveryKey(ownerId));
  return raw === null ? null : pendingSchema.parse(JSON.parse(raw));
}
export function savePersonalPending(storage: Pick<Storage, "setItem" | "removeItem">, ownerId: string, pending: PendingPersonalOperation | null) {
  if (pending) storage.setItem(recoveryKey(ownerId), JSON.stringify(pendingSchema.parse(pending)));
  else storage.removeItem(recoveryKey(ownerId));
}
