import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getTextbookActionErrorMessage } from "../src/features/textbooks/textbook-ledger.js";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/supabase") return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent('export const supabase = null; export const supabaseConfigError = "";')}` };
    if (specifier.startsWith("@/")) specifier = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href;
    if (specifier.startsWith(".") || specifier.startsWith("file:")) {
      const path = fileURLToPath(new URL(specifier, context.parentURL));
      if (!extname(path)) {
        const resolved = [".ts", ".js"].map(suffix => path + suffix).find(existsSync);
        if (resolved) specifier = pathToFileURL(resolved).href;
      }
    }
    return nextResolve(specifier, context);
  },
});
const { updatePurchaseLifecycle, deletePurchaseLifecycle, returnPurchaseLifecycle, deleteSaleLineLifecycle } = await import('../src/features/textbooks/textbook-service.ts');
const id = 'a9100000-0000-4000-8000-000000000001';
const orderId = 'a9100000-0000-4000-8000-000000000002';
const bookId = 'a9100000-0000-4000-8000-000000000003';
const receipt = {
  id, purchaseOrderId: orderId, textbookId: bookId, stage: 'receive', requestedQuantity: 10,
  orderedQuantity: 10, receivedQuantity: 10, unitCost: 1000.5, statementNumber: 'fixture', createdBy: 'untrusted-actor',
};
const committed = { order: { id: orderId, status: 'received' }, line: { id, purchase_order_id: orderId, received_quantity: 10 } };
function clientWith(data, error = null, inspect = () => {}) {
  return {
    async rpc(name, args) { inspect(name, args); return { data, error }; },
    from() { assert.fail('lifecycle writes must remain in the single authoritative transaction'); },
  };
}
test('receipt saves through one atomic transaction and uses the committed projection', async () => {
  const result = await updatePurchaseLifecycle(receipt, clientWith(committed, null, (name, args) => {
    assert.equal(name, 'update_textbook_purchase_lifecycle_v1');
    assert.equal(args.p_line_id, id);
    assert.equal(args.p_order_id, orderId);
    assert.equal(args.p_stage, 'receive');
    assert.equal(args.p_line.unit_cost, 1000.5);
    assert.equal(args.p_line.received_quantity, 10);
    assert.equal(args.p_line.created_by, undefined);
    assert.equal(args.p_order.created_by, undefined);
  }));
  assert.deepEqual(result, committed);
});
test('receipt projection rejects missing or mismatched rows', async () => {
  for (const value of [null, {}, { ...committed, order: { id: orderId, status: 'ordered' } },
    { ...committed, line: { ...committed.line, purchase_order_id: bookId } },
    { ...committed, line: { ...committed.line, received_quantity: 0 } }]) {
    await assert.rejects(updatePurchaseLifecycle(receipt, clientWith(value)), /결과를 확인할 수 없습니다/);
  }
});
test('UUID case normalization accepts committed receipt rows', async () => {
  const result = await updatePurchaseLifecycle({ ...receipt, id: id.toUpperCase(), purchaseOrderId: orderId.toUpperCase() }, clientWith(committed));
  assert.deepEqual(result, committed);
});
for (const [method, rpcName, resultKey] of [
  [deletePurchaseLifecycle, 'delete_textbook_purchase_line_v1', 'purchaseOrderLineId'],
  [returnPurchaseLifecycle, 'return_textbook_purchase_line_v1', 'purchaseOrderLineId'],
  [deleteSaleLineLifecycle, 'delete_textbook_sale_line_v1', 'saleLineId'],
]) {
  test(`${rpcName} uses only identity and intent even with stale browser quantities`, async () => {
    const projection = { [resultKey]: id };
    const result = await method({ id: id.toUpperCase(), receivedQuantity: 999, unitCost: 1, memo: '반품' }, clientWith(projection, null, (name, args) => {
      assert.equal(name, rpcName);
      assert.deepEqual(args, { p_line_id: id, ...(method === returnPurchaseLifecycle ? { p_memo: '반품' } : {}) });
    }));
    assert.deepEqual(result, projection);
    await assert.rejects(method({ id }, clientWith({ [resultKey]: bookId })), /결과를 확인할 수 없습니다/);
  });
}
test('every failed transaction propagates its error without direct-write fallback', async () => {
  const error = { code: '23514', message: 'textbook_purchase_state_conflict' };
  for (const method of [updatePurchaseLifecycle, deletePurchaseLifecycle, returnPurchaseLifecycle, deleteSaleLineLifecycle]) {
    await assert.rejects(method(receipt, clientWith(null, error)), actual => actual === error);
  }
});
test('purchase conflict errors explain the next action', () => {
  assert.match(getTextbookActionErrorMessage({ message: 'textbook_purchase_state_conflict' }), /새로고침/);
  assert.match(getTextbookActionErrorMessage({ message: 'textbook_purchase_stock_conflict' }), /재고/);
  assert.match(getTextbookActionErrorMessage({ message: 'textbook_purchase_forbidden' }), /권한/);
});
