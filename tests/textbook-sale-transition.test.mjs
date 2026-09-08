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
const { updateSaleLineStatus } = await import("../src/features/textbooks/textbook-service.ts");
const id = "a9100000-0000-4000-8000-000000000001";

test("sale transition sends only identity and intent; the returned DB row replaces stale client data", async () => {
  const updated = { id, status: "issued", quantity: 3, unit_price: 12000, copy_scope: "teacher", location_id: null };
  const client = {
    rpc: async (name, args) => {
      assert.equal(name, "transition_textbook_sale_line_v1");
      assert.deepEqual(args, { p_sale_line_id: id, p_target_status: "issued" });
      return { data: updated, error: null };
    },
    from: () => assert.fail("a browser must not split the stock movement and status write"),
  };
  const result = await updateSaleLineStatus({ saleLineId: id, status: "issued", createdBy: "untrusted-actor" }, {
    saleLines: [{ id, quantity: 99, unit_price: 1, status: "charged" }],
  }, client);
  assert.deepEqual(result, updated);
});

test("return retries reach the authoritative transaction even when the client row is missing", async () => {
  const updated = { id, status: "returned" };
  const result = await updateSaleLineStatus({ sale_line_id: id, target_status: "returned" }, {}, {
    rpc: async (name, args) => {
      assert.equal(name, "transition_textbook_sale_line_v1");
      assert.equal(args.p_target_status, "returned");
      return { data: updated, error: null };
    },
  });
  assert.deepEqual(result, updated);
});

test("UUID letter case does not turn a committed transition into a client failure", async () => {
  const result = await updateSaleLineStatus({ id: id.toUpperCase(), status: "issued" }, {}, {
    rpc: async (_name, args) => {
      assert.equal(args.p_sale_line_id, id);
      return { data: { id, status: "issued" }, error: null };
    },
  });
  assert.equal(result.status, "issued");
});

test("database rejection is propagated and never retried as direct table writes", async () => {
  const error = { code: "23514", message: "textbook_sale_state_conflict" };
  await assert.rejects(updateSaleLineStatus({ id, status: "issued" }, {}, {
    rpc: async () => ({ data: null, error }),
    from: () => assert.fail("no unsafe fallback"),
  }), actual => actual === error);
});

test("a missing or mismatched transaction response cannot report success", async () => {
  for (const data of [null, {}, { id, status: "charged" }, { id: "different-line", status: "issued" }]) {
    await assert.rejects(updateSaleLineStatus({ id, status: "issued" }, {}, {
      rpc: async () => ({ data, error: null }),
    }), /출고 처리 결과를 확인할 수 없습니다/);
  }
});

test("invalid status is rejected before contacting the database", async () => {
  await assert.rejects(updateSaleLineStatus({ id, status: "paid" }, {}, {
    rpc: () => assert.fail("invalid intent must not reach the DB"),
  }), /지원하지 않는 출고 상태/);
});

test("sale conflicts provide an actionable Korean message without exposing database identifiers", () => {
  assert.match(getTextbookActionErrorMessage({ code: "23514", message: "textbook_sale_state_conflict" }), /상태.*새로고침/);
  assert.match(getTextbookActionErrorMessage({ code: "23514", message: "textbook_sale_stock_conflict" }), /재고 이동.*확인/);
  assert.match(getTextbookActionErrorMessage({ code: "P0002", message: "textbook_sale_not_found" }), /찾을 수 없/);
  assert.match(getTextbookActionErrorMessage({ code: "42501", message: "textbook_sale_forbidden" }), /권한/);
});
