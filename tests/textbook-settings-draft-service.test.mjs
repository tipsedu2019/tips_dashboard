import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";

const feature = new URL("../src/features/textbooks/", import.meta.url);
const url = new URL("../src/features/textbooks/textbook-settings-draft-service.ts", import.meta.url);
registerHooks({ resolve(specifier, context, nextResolve) { if (specifier === "@/lib/supabase" && context.parentURL?.startsWith(feature.href)) return { url: 'data:text/javascript,export const supabase=null;export const supabaseConfigError="unconfigured";', shortCircuit: true }; if (specifier.startsWith("./") && context.parentURL?.startsWith(feature.href)) { const candidate = new URL(`${specifier}.ts`, context.parentURL); if (existsSync(candidate)) return nextResolve(candidate.href, context); } return nextResolve(specifier, context); } });
const id = "6a000000-0000-4000-8000-000000000009";
test("atomic draft service rejects an invalid empty owner envelope before transport", async () => {
  const { saveTextbookSettingsDraft } = await import(url.href);
  assert.throws(() => saveTextbookSettingsDraft({ requestId: id, draft: { version: 1, owners: null, subSubjects: null } }), /textbook_read_input_invalid/);
});

test("atomic draft service freezes exact RPC body and rejects malformed receipts", async () => {
  const { saveTextbookSettingsDraft } = await import(url.href);
  const request = { requestId: id, draft: { version: 1, owners: { version: 1, baseRevision: "a".repeat(64), operations: [] }, subSubjects: null } };
  const calls = [];
  const client = { rpc(name, args) { calls.push({ name, args }); return { abortSignal() { return this; }, retry() { return Promise.resolve({ data: { requestId: id, owners: { baseRevision: "a".repeat(64), newRevision: "a".repeat(64), changedPublisherIds: [], deletedPublisherIds: [], changedSupplierIds: [], deletedSupplierIds: [], changedLinkPublisherIds: [] }, subSubjects: null }, error: null }); } }; } };
  const result = await saveTextbookSettingsDraft(request, { client });
  assert.equal(result.requestId, id);
  assert.deepEqual(calls, [{ name: "save_textbook_settings_draft_v1", args: { p_request_id: id, p_draft: request.draft } }]);
  const receipt = { requestId: id, owners: { baseRevision: "a".repeat(64), newRevision: "b".repeat(64), changedPublisherIds: ["6a000000-0000-4000-8000-000000000011", "6a000000-0000-4000-8000-000000000010"], deletedPublisherIds: [], changedSupplierIds: [], deletedSupplierIds: [], changedLinkPublisherIds: [] }, subSubjects: null };
  const bad = { rpc() { return { abortSignal() { return this; }, retry() { return Promise.resolve({ data: receipt, error: null }); } }; } };
  await assert.rejects(() => saveTextbookSettingsDraft(request, { client: bad }), /textbook_read_response_invalid/);
  receipt.owners.changedPublisherIds = ["6a000000-0000-4000-8000-000000000010"];
  receipt.owners.deletedPublisherIds = ["6a000000-0000-4000-8000-000000000010"];
  await assert.rejects(() => saveTextbookSettingsDraft(request, { client: bad }), /textbook_read_response_invalid/);
  receipt.owners.deletedPublisherIds = [];
  receipt.owners.baseRevision = "c".repeat(64);
  await assert.rejects(() => saveTextbookSettingsDraft(request, { client: bad }), /textbook_read_response_invalid/);
  receipt.owners.baseRevision = "a".repeat(64);
  receipt.owners.changedPublisherIds = ["6A000000-0000-4000-8000-000000000010"];
  await assert.rejects(() => saveTextbookSettingsDraft(request, { client: bad }), /textbook_read_response_invalid/, "UUID receipts must retain canonical lowercase SQL form");
  receipt.owners.changedPublisherIds = [];
  receipt.owners.changedLinkPublisherIds = ["6a000000-0000-4000-8000-000000000010"];
  receipt.owners.deletedPublisherIds = ["6a000000-0000-4000-8000-000000000010"];
  await assert.rejects(() => saveTextbookSettingsDraft(request, { client: bad }), /textbook_read_response_invalid/);
});

test("atomic draft save has no automatic retry and preserves abort and unknown transport errors", async () => {
  const { saveTextbookSettingsDraft } = await import(url.href);
  const request = { requestId: id, draft: { version: 1, owners: { version: 1, baseRevision: "a".repeat(64), operations: [] }, subSubjects: null } };
  const unknown = new Error("gateway failed");
  let retryValue;
  const transport = { rpc() { return { abortSignal() { return this; }, retry(value) { retryValue = value; return Promise.resolve({ data: null, error: unknown }); } }; } };
  await assert.rejects(() => saveTextbookSettingsDraft(request, { client: transport }), error => error === unknown);
  assert.equal(retryValue, false);
  const cancelled = new AbortController(); cancelled.abort();
  let calls = 0;
  await assert.rejects(() => saveTextbookSettingsDraft(request, { signal: cancelled.signal, client: { rpc() { calls += 1; throw new Error("must not send"); } } }), { name: "AbortError" });
  assert.equal(calls, 0);
});
