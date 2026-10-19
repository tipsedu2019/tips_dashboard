import { supabase as sharedSupabase } from "@/lib/supabase";
import { buildPurchaseLifecycleDraft, getTextbookCopyScope, normalizeOptionalUuid, validatePurchaseLifecycleDraft } from "./textbook-ledger.js";

type Row = Record<string, unknown>;
type Client = NonNullable<typeof sharedSupabase>;
type Step = { table: "textbook_purchase_orders" | "textbook_purchase_order_lines" | "textbook_stock_moves"; row: Row; state: "ready" | "unknown" | "confirmed" };
export type PurchaseAttempt = { version: 1; id: string; actorId: string; draft: Row; steps: Step[] };
const text = (value: unknown) => String(value || "").trim();
const number = (value: unknown) => Number(value) || 0;
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const failure = (message: string) => new Error(message);
const activeAttempts = new Set<string>();
const storageKey = (actorId: string) => `tips.textbook-new-purchase.v1:${actorId}`;
// Only PostgreSQL statement rollback errors. Transport/client-generated errors,
// including PGRST116 after a successful write, never establish non-commit.
const rollbackStatuses: Record<string, number[]> = {
  "23502": [400], "23503": [409], "23514": [400], "22P02": [400], "22003": [400],
  "42501": [401, 403], "40001": [500], "40P01": [500], "P0001": [400],
};

export function createPurchaseAttempt(records: Row[], actorId: string, draft: Row): PurchaseAttempt {
  if (!normalizeOptionalUuid(actorId) || records.length < 1 || records.length > 2) throw failure("textbook_purchase_retry_invalid");
  const now = new Date().toISOString();
  const steps: Step[] = [];
  const scopes = new Set<string>();
  for (const record of records) {
    const textbookId = normalizeOptionalUuid(record.textbookId);
    const locationId = normalizeOptionalUuid(record.locationId);
    const scope = getTextbookCopyScope(record);
    const lifecycle = validatePurchaseLifecycleDraft(buildPurchaseLifecycleDraft({
      stage: text(record.requestStage), requestedQuantity: number(record.requestedQuantity),
      orderedQuantity: number(record.orderedQuantity), receivedQuantity: number(record.receivedQuantity),
      statementNumber: text(record.statementNumber), copyScope: scope,
    }));
    if (!textbookId || !locationId || !["order", "receive"].includes(lifecycle.stage) || scopes.has(scope)) throw failure("textbook_purchase_retry_invalid");
    scopes.add(scope);
    const orderId = crypto.randomUUID(), lineId = crypto.randomUUID();
    const unitCost = scope === "teacher" ? 0 : Math.max(0, number(record.unitCost));
    steps.push({ table: "textbook_purchase_orders", state: "ready", row: {
      id: orderId, supplier_id: normalizeOptionalUuid(record.supplierId), requested_by: text(record.requestBy || record.requestedBy),
      requested_date: text(record.requestDate) || now.slice(0, 10), order_date: text(record.orderDate) || now.slice(0, 10),
      ordered_at: now, received_at: lifecycle.stage === "receive" ? now : null, status: lifecycle.status,
      statement_number: lifecycle.statementNumber, memo: text(record.memo), created_by: actorId,
    } });
    steps.push({ table: "textbook_purchase_order_lines", state: "ready", row: {
      id: lineId, purchase_order_id: orderId, textbook_id: textbookId, requested_textbook_title: text(record.requestedTextbookTitle),
      class_id: normalizeOptionalUuid(record.classId), location_id: locationId, requested_quantity: lifecycle.requestedQuantity,
      ordered_quantity: lifecycle.orderedQuantity, received_quantity: lifecycle.receivedQuantity,
      copy_scope: scope, unit_cost: unitCost, memo: text(record.memo),
    } });
    if (lifecycle.createsStockMove) steps.push({ table: "textbook_stock_moves", state: "ready", row: {
      id: crypto.randomUUID(), textbook_id: textbookId, location_id: locationId, purchase_order_line_id: lineId,
      move_type: "purchase_receipt", quantity: lifecycle.receivedQuantity, unit_amount: unitCost,
      amount: lifecycle.receivedQuantity * unitCost, memo: text(record.memo), copy_scope: scope, created_by: actorId,
    } });
  }
  return { version: 1, id: crypto.randomUUID(), actorId, draft: copy(draft), steps };
}

const rowKeys = {
  textbook_purchase_orders: "id supplier_id requested_by requested_date order_date ordered_at received_at status statement_number memo created_by",
  textbook_purchase_order_lines: "id purchase_order_id textbook_id requested_textbook_title class_id location_id requested_quantity ordered_quantity received_quantity copy_scope unit_cost memo",
  textbook_stock_moves: "id textbook_id location_id purchase_order_line_id move_type quantity unit_amount amount memo copy_scope created_by",
};
const uuid = (value: unknown) => typeof value === "string" && Boolean(normalizeOptionalUuid(value));
const optionalUuid = (value: unknown) => value === null || uuid(value);
const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const timestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
function validAttempt(value: PurchaseAttempt, actorId: string) {
  if (value?.version !== 1 || value.actorId !== actorId || !uuid(actorId) || !uuid(value.id)
    || !value.draft || typeof value.draft !== "object" || Array.isArray(value.draft)
    || !Object.values(value.draft).every(item => typeof item === "string")
    || !["order", "receive"].includes(String(value.draft.requestStage))
    || !Array.isArray(value.steps) || value.steps.length < 2 || value.steps.length > 6) return false;
  const ids = new Set<string>(), scopes = new Set<unknown>();
  let unfinished = false;
  for (const step of value.steps) {
    if (!step || !Object.prototype.hasOwnProperty.call(rowKeys, step.table) || !["ready", "unknown", "confirmed"].includes(step.state)
      || !step.row || typeof step.row !== "object" || Array.isArray(step.row) || !uuid(step.row.id)
      || ids.has(String(step.row.id))
      || Object.keys(step.row).sort().join(" ") !== rowKeys[step.table].split(" ").sort().join(" ")) return false;
    ids.add(String(step.row.id));
    if (unfinished && step.state !== "ready") return false;
    if (step.state !== "confirmed") unfinished = true;
  }
  for (let index = 0; index < value.steps.length;) {
    const orderStep = value.steps[index++], lineStep = value.steps[index++];
    if (orderStep?.table !== "textbook_purchase_orders" || lineStep?.table !== "textbook_purchase_order_lines") return false;
    const order = orderStep.row, line = lineStep.row;
    const receive = value.draft.requestStage === "receive";
    if (order.created_by !== actorId || !optionalUuid(order.supplier_id)
      || ![order.requested_by, order.statement_number, order.memo].every(item => typeof item === "string")
      || ![order.requested_date, order.order_date].every(item => typeof item === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item) && timestamp(item))
      || !timestamp(order.ordered_at) || (receive ? !timestamp(order.received_at) : order.received_at !== null)
      || line.purchase_order_id !== order.id || !uuid(line.textbook_id) || !uuid(line.location_id) || !optionalUuid(line.class_id)
      || ![line.requested_textbook_title, line.memo].every(item => typeof item === "string")
      || ![line.requested_quantity, line.ordered_quantity, line.received_quantity, line.unit_cost].every(numeric)
      || Number(line.ordered_quantity) <= 0 || (receive ? Number(line.received_quantity) <= 0 || !order.statement_number : line.received_quantity !== 0)
      || !["student", "teacher"].includes(String(line.copy_scope)) || scopes.has(line.copy_scope)
      || (line.copy_scope === "teacher" && line.unit_cost !== 0)
      || order.status !== (receive ? Number(line.received_quantity) >= Number(line.ordered_quantity) ? "received" : "partially_received" : "ordered")) return false;
    scopes.add(line.copy_scope);
    if (receive) {
      const moveStep = value.steps[index++];
      if (moveStep?.table !== "textbook_stock_moves") return false;
      const move = moveStep.row;
      if (move.created_by !== actorId || move.purchase_order_line_id !== line.id || move.textbook_id !== line.textbook_id
        || move.location_id !== line.location_id || move.copy_scope !== line.copy_scope || move.move_type !== "purchase_receipt"
        || move.quantity !== line.received_quantity || move.unit_amount !== line.unit_cost
        || move.amount !== Number(line.received_quantity) * Number(line.unit_cost) || move.memo !== line.memo) return false;
    }
  }
  return scopes.size > 0 && scopes.size <= 2;
}
export function readPurchaseAttempt(actorId: string, storage: Storage): PurchaseAttempt | null {
  try {
    const raw = storage.getItem(storageKey(actorId));
    if (raw === null) return null;
    const value = JSON.parse(raw) as PurchaseAttempt;
    if (!validAttempt(value, actorId)) throw failure("invalid attempt");
    return value;
  } catch { throw failure("textbook_purchase_retry_storage"); }
}
export function savePurchaseAttempt(attempt: PurchaseAttempt, storage: Storage) {
  try {
    if (!validAttempt(attempt, attempt.actorId)) throw failure("invalid attempt");
    const raw = JSON.stringify(attempt);
    storage.setItem(storageKey(attempt.actorId), raw);
    if (storage.getItem(storageKey(attempt.actorId)) !== raw) throw failure("storage write failed");
  } catch { throw failure("textbook_purchase_retry_storage"); }
}
export function discardUnwrittenPurchaseAttempt(attempt: PurchaseAttempt, storage: Storage) {
  try {
    if (!attempt.steps.every(step => step.state === "ready") || readPurchaseAttempt(attempt.actorId, storage)?.id !== attempt.id) throw failure("attempt is not unwritten");
    storage.removeItem(storageKey(attempt.actorId));
    if (storage.getItem(storageKey(attempt.actorId)) !== null) throw failure("storage removal failed");
  } catch { throw failure("textbook_purchase_retry_storage"); }
}
export function finishPurchaseAttempt(attempt: PurchaseAttempt, storage: Storage) {
  try {
    if (!attempt.steps.every(step => step.state === "confirmed") || readPurchaseAttempt(attempt.actorId, storage)?.id !== attempt.id) throw failure("attempt changed");
    storage.removeItem(storageKey(attempt.actorId));
    if (storage.getItem(storageKey(attempt.actorId)) !== null) throw failure("storage removal failed");
  } catch { throw failure("textbook_purchase_retry_storage"); }
}
function matches(row: unknown, expected: Row) {
  if (!row || typeof row !== "object") return false;
  const actual = row as Row;
  return Object.entries(expected).every(([key, value]) => {
    if (value === null) return actual[key] === null;
    if (typeof value === "number") return actual[key] !== null && actual[key] !== undefined && Number(actual[key]) === value;
    if (key.endsWith("_at")) return new Date(String(actual[key])).getTime() === new Date(String(value)).getTime();
    return actual[key] === value;
  });
}

/** Sequential resumable statements, not a database transaction. Never upsert,
 * overwrite, or recreate a confirmed/uncertain step whose row is absent. */
export async function resumePurchaseAttempt(attempt: PurchaseAttempt, options: {
  actorId: string; checkpoint: (attempt: PurchaseAttempt) => void; assertCurrent: () => void; client?: Client;
}) {
  const client = options.client || sharedSupabase;
  if (!client || !validAttempt(attempt, options.actorId)) throw failure("textbook_purchase_retry_invalid");
  if (activeAttempts.has(attempt.id)) throw failure("textbook_purchase_retry_busy");
  activeAttempts.add(attempt.id);
  const checkpoint = (step: Step, state: Step["state"]) => {
    step.state = state;
    options.checkpoint(copy(attempt));
  };
  const verify = async (step: Step) => {
    options.assertCurrent();
    const { data, error } = await client.from(step.table).select("*").eq("id", step.row.id).maybeSingle()
      .then(result => result, () => { throw failure("textbook_purchase_retry_unresolved"); });
    if (error || !matches(data, step.row)) throw failure("textbook_purchase_retry_unresolved");
    if (step.state !== "confirmed") checkpoint(step, "confirmed");
  };
  try {
    for (const step of attempt.steps) {
      options.assertCurrent();
      if (step.state !== "ready") { await verify(step); continue; }
      // Persist BEFORE sending: a reload, lost reply, or failed checkpoint cannot
      // turn a possibly committed insert back into permission to insert again.
      checkpoint(step, "unknown");
      options.assertCurrent();
      const result = await client.from(step.table).insert(step.row).select().single()
        .then(result => result, () => { throw failure("textbook_purchase_retry_unresolved"); });
      if (result.error) {
        if (result.error.code === "23505") { await verify(step); continue; }
        const serverRollback = rollbackStatuses[result.error.code]?.includes(result.status)
          && typeof result.error.message === "string"
          && Object.prototype.hasOwnProperty.call(result.error, "details") && (result.error.details === null || typeof result.error.details === "string")
          && Object.prototype.hasOwnProperty.call(result.error, "hint") && (result.error.hint === null || typeof result.error.hint === "string");
        if (serverRollback) checkpoint(step, "ready");
        throw failure(serverRollback ? "textbook_purchase_retry_ready" : "textbook_purchase_retry_unresolved");
      }
      if (!matches(result.data, step.row)) throw failure("textbook_purchase_retry_unresolved");
      checkpoint(step, "confirmed");
    }
    // A previously successful row may have been edited or deleted by another
    // workflow. Do not report completion, overwrite it, or recreate it.
    for (const step of attempt.steps) await verify(step);
    options.assertCurrent();
    return attempt;
  } finally { activeAttempts.delete(attempt.id); }
}
