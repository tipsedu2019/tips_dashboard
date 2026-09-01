import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inspectQuerySurfaceSource } from "../src/lib/query-surface-budget.js";

const serviceUrl = new URL("../src/features/textbooks/textbook-owner-settings-service.ts", import.meta.url);
const pages = [
  "list_textbook_publisher_page_v1",
  "list_textbook_supplier_page_v1",
  "list_textbook_supplier_setting_picker_page_v1",
];
const selectedOrSave = [
  "get_textbook_publisher_setting_detail_v1",
  "get_textbook_supplier_setting_detail_v1",
  "save_textbook_settings_draft_v1",
];
const inspect = (name, args, suffix = ".abortSignal(AbortSignal.timeout(8000)).retry(false)") => inspectQuerySurfaceSource({
  surface: "management",
  file: "src/features/textbooks/owner-settings-fixture.ts",
  source: `async function read(client, request) { return client.rpc(${JSON.stringify(name)}, ${args})${suffix} }`,
}).map(item => item.reason);

test("owner settings query budget admits exactly three numbered RPCs at 10/15/20", () => {
  for (const rpc of pages) {
    for (const size of ["10", "15", "20", "request.pageSize"]) assert.deepEqual(inspect(rpc, `{p_page:11,p_page_size:${size}}`), []);
    for (const size of ["5", "30", "null"]) assert.deepEqual(inspect(rpc, `{p_page:11,p_page_size:${size}}`), ["rpc_page_limit_invalid"]);
    assert.deepEqual(inspect(rpc.replace("v1", "v2"), "{p_page:11,p_page_size:10}"), ["rpc_page_limit_missing"]);
  }
});

test("owner settings permits only its two selected details and atomic save as nonpageable", () => {
  for (const rpc of selectedOrSave) {
    assert.deepEqual(inspect(rpc, "{}"), []);
    assert.deepEqual(inspect(rpc.replace("v1", "v2"), "{}"), ["rpc_page_limit_missing"]);
  }
  for (const rpc of pages) {
    assert.ok(inspect(rpc, "{p_page:1,p_page_size:10}", ".retry(false)").includes("list_abort_signal_missing"));
    assert.ok(inspect(rpc, "{p_page:1,p_page_size:10}", ".abortSignal(AbortSignal.timeout(8000))").includes("list_retry_false_missing"));
  }
});

test("actual owner settings service has no query-budget exemption or unresolved dynamic RPC", () => {
  const source = readFileSync(serviceUrl, "utf8");
  assert.deepEqual(inspectQuerySurfaceSource({ surface: "management", file: "src/features/textbooks/textbook-owner-settings-service.ts", source }), []);
});
