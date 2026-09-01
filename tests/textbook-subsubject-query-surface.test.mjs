import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inspectQuerySurfaceSource } from "../src/lib/query-surface-budget.js";

const serviceUrl = new URL("../src/features/textbooks/textbook-subsubject-service.ts", import.meta.url);
const rpc = "list_textbook_sub_subject_numbered_page_v1";
const inspect = (name, args, suffix = ".abortSignal(AbortSignal.timeout(8000)).retry(false)") => inspectQuerySurfaceSource({
  surface: "management",
  file: "src/features/textbooks/subsubject-query-fixture.ts",
  source: `async function read(client, request) { return client.rpc(${JSON.stringify(name)}, ${args})${suffix} }`,
}).map(item => item.reason);

test("sub-subject query budget admits only the final numbered RPC at 10/15/20", () => {
  for (const size of ["10", "15", "20", "request.pageSize"]) {
    assert.deepEqual(inspect(rpc, `{p_page:11,p_page_size:${size}}`), []);
  }
  for (const size of ["5", "30", "null"]) {
    assert.deepEqual(inspect(rpc, `{p_page:11,p_page_size:${size}}`), ["rpc_page_limit_invalid"]);
  }
  assert.deepEqual(inspect(rpc.replace("v1", "v2"), "{p_page:11,p_page_size:10}"), ["rpc_page_limit_missing"]);
});

test("sub-subject numbered RPC requires an 8-second abort and retry(false)", () => {
  assert.ok(inspect(rpc, "{p_page:1,p_page_size:10}", ".retry(false)").includes("list_abort_signal_missing"));
  assert.ok(inspect(rpc, "{p_page:1,p_page_size:10}", ".abortSignal(AbortSignal.timeout(8000))").includes("list_retry_false_missing"));
  assert.ok(inspect(rpc, "{p_page:1,p_page_size:10}", ".abortSignal(AbortSignal.timeout(9000)).retry(false)").includes("list_abort_signal_missing"));
});

test("actual sub-subject service has no query-budget exemption or unresolved RPC", () => {
  const source = readFileSync(serviceUrl, "utf8");
  assert.deepEqual(inspectQuerySurfaceSource({
    surface: "management",
    file: "src/features/textbooks/textbook-subsubject-service.ts",
    source,
  }), []);
});
