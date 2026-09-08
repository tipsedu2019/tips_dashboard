import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getTextbookActionErrorMessage } from "../src/features/textbooks/textbook-ledger.js";

registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@/lib/supabase") return { shortCircuit: true, url: 'data:text/javascript,export const supabase=null;export const supabaseConfigError="";' };
  if (specifier.startsWith("@/")) specifier = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href;
  if (specifier.startsWith(".") || specifier.startsWith("file:")) {
    const path = fileURLToPath(new URL(specifier, context.parentURL));
    if (!extname(path)) {
      const target = [".ts", ".js"].map(suffix => path + suffix).find(existsSync);
      if (target) specifier = pathToFileURL(target).href;
    }
  }
  return next(specifier, context);
} });
const { createStockCountAdjustment, deleteInventoryHistory } = await import("../src/features/textbooks/textbook-service.ts");
const id = n => `a9300000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const input = { requestId: id(1), textbookId: id(800), locationId: id(900), expectedQuantity: 10, countedQuantity: 7, countedAt: "2026-09-08", sale_price: 12000.5, memo: "실사", createdBy: id(999) };
const row = { id: id(1), textbook_id: id(800), location_id: id(900), expected_quantity: 10, counted_quantity: 7, adjustment_move_id: id(2), counted_at: "2026-09-08", memo: "실사" };
const noTables = () => assert.fail("count and adjustment must use one database transaction");

test("stock count writes one transaction with a stable request identity and reads back its linked result", async () => {
  const actual = await createStockCountAdjustment(input, { from: noTables, rpc: async (name, args) => {
    assert.equal(name, "create_textbook_stock_count_v1");
    assert.deepEqual(args, { p_request_id: id(1), p_textbook_id: id(800), p_location_id: id(900), p_expected_quantity: 10,
      p_counted_quantity: 7, p_counted_at: "2026-09-08", p_unit_amount: 12000.5, p_memo: "실사" });
    return { data: row, error: null };
  } });
  assert.deepEqual(actual, row);
});

test("response loss retains the supplied request identity on retry", async () => {
  const calls = [];
  const client = { from: noTables, rpc: async (_name, args) => {
    calls.push(args);
    return calls.length === 1 ? { data: null, error: { message: "Failed to fetch" } } : { data: row, error: null };
  } };
  await assert.rejects(createStockCountAdjustment(input, client));
  assert.deepEqual(await createStockCountAdjustment({ ...input, expectedQuantity: 7 }, client), row);
  assert.equal(calls[0].p_request_id, calls[1].p_request_id);
});

test("zero count, negative expected stock and nullable location are preserved", async () => {
  await createStockCountAdjustment({ ...input, requestId: id(1).toUpperCase(), countedQuantity: 0, expectedQuantity: -2, locationId: null }, {
    rpc: async (_name, args) => {
      assert.equal(args.p_request_id, id(1));
      assert.equal(args.p_counted_quantity, 0);
      assert.equal(args.p_expected_quantity, -2);
      assert.equal(args.p_location_id, null);
      return { data: { ...row, counted_quantity: 0, location_id: null }, error: null };
    },
  });
});

test("invalid quantities and missing identity fail before any write", async () => {
  for (const patch of [{ requestId: "" }, { countedQuantity: -1 }, { countedQuantity: 1.5 }, { countedQuantity: "" }, { expectedQuantity: Infinity }]) {
    let contacted = false;
    const unexpectedWrite = () => { contacted = true; throw new Error("unexpected write"); };
    await assert.rejects(createStockCountAdjustment({ ...input, ...patch }, { rpc: unexpectedWrite, from: unexpectedWrite }));
    assert.equal(contacted, false, "invalid input must not contact the database");
  }
});

test("a missing, wrong or unlinked count result cannot report success", async () => {
  for (const data of [null, {}, { ...row, id: id(3) }, { ...row, counted_quantity: 8 }, { ...row, adjustment_move_id: null }]) {
    await assert.rejects(createStockCountAdjustment(input, { rpc: async () => ({ data, error: null }), from: noTables }), /실사 저장 결과를 확인할 수 없습니다/);
  }
});

test("deleting either history kind sends only its authoritative identity", async () => {
  for (const kind of ["count", "move"]) {
    const expected = { kind, id: id(1), deleted: true };
    assert.deepEqual(await deleteInventoryHistory({ kind, id: id(1), linkedMoveId: id(999) }, {
      rpc: async (name, args) => {
        assert.equal(name, "delete_textbook_inventory_history_v1");
        assert.deepEqual(args, { p_kind: kind, p_id: id(1) });
        return { data: expected, error: null };
      }, from: noTables,
    }), expected);
  }
});

test("transaction failure never falls back to partial direct writes", async () => {
  const error = { code: "23514", message: "textbook_count_history_conflict" };
  const client = { rpc: async () => ({ data: null, error }), from: noTables };
  await assert.rejects(createStockCountAdjustment(input, client), actual => actual === error);
  await assert.rejects(deleteInventoryHistory({ kind: "count", id: id(1) }, client), actual => actual === error);
});

test("invalid delete intent and unconfirmed result fail closed", async () => {
  await assert.rejects(deleteInventoryHistory({ kind: "other", id: id(1) }, { rpc: noTables, from: noTables }));
  await assert.rejects(deleteInventoryHistory({ kind: "count", id: id(1) }, { rpc: async () => ({ data: null, error: null }) }), /삭제 결과를 확인할 수 없습니다/);
});

test("stock count conflicts explain the required recovery in Korean", () => {
  assert.match(getTextbookActionErrorMessage({ code: "23514", message: "textbook_count_balance_changed" }), /재고.*변경.*다시/);
  assert.match(getTextbookActionErrorMessage({ code: "23514", message: "textbook_count_request_deleted" }), /삭제.*실사/);
  assert.match(getTextbookActionErrorMessage({ code: "23514", message: "textbook_count_history_conflict" }), /실사.*확인/);
});
