import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

const feature = new URL("../src/features/textbooks/", import.meta.url);
const serviceUrl = new URL("../src/features/textbooks/textbook-subsubject-service.ts", import.meta.url);
const id = (value) => `6d000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const revision = "b".repeat(64);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/supabase" && context.parentURL?.startsWith(feature.href)) {
      return { url: 'data:text/javascript,export const supabase=null;export const supabaseConfigError="unconfigured";', shortCircuit: true };
    }
    if (specifier.startsWith("./") && context.parentURL?.startsWith(feature.href)) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const request = (patch = {}) => ({
  page: 11,
  pageSize: 10,
  filters: { subject: "other", search: "" },
  draft: null,
  ...patch,
});
const envelope = (patch = {}) => ({
  rows: [],
  page: 11,
  pageSize: 10,
  totalCount: 100,
  baseRevision: revision,
  visibleCount: 118,
  subjectCounts: { english: 6, math: 9, science: 5, other: 101 },
  ...patch,
});

test("strict taxonomy service exports and calls the real bounded method", async () => {
  assert.equal(existsSync(serviceUrl), true, "textbook-subsubject-service.ts must exist");
  const service = await import(serviceUrl.href);
  assert.equal(typeof service.listTextbookSubSubjectPage, "function");
  await assert.rejects(() => service.listTextbookSubSubjectPage(request({ page: 1 })), /unconfigured|unavailable/i);
});

test("taxonomy transport uses exactly the four-argument RPC with no retry or fallback", async () => {
  const { listTextbookSubSubjectPage } = await import(serviceUrl.href);
  const calls = [];
  let retryValue;
  const draft = { version: 1, baseRevision: revision, operations: [] };
  const input = request({ draft });
  const client = { rpc(name, args) { calls.push({ name, args }); return { abortSignal() { return this; }, retry(value) { retryValue = value; return Promise.resolve({ data: envelope(), error: null }); } }; } };
  const page = await listTextbookSubSubjectPage(input, { client });
  assert.equal(page.totalCount, 100);
  assert.equal(retryValue, false);
  assert.deepEqual(calls, [{
    name: "list_textbook_sub_subject_numbered_page_v1",
    args: { p_filters: input.filters, p_draft: draft, p_page: 11, p_page_size: 10 },
  }]);

  let missingCalls = 0;
  const missing = { rpc() { missingCalls += 1; return { abortSignal() { return this; }, retry() { return Promise.resolve({ data: null, error: { code: "PGRST202" } }); } }; } };
  await assert.rejects(() => listTextbookSubSubjectPage(request({ page: 1 }), { client: missing }), { code: "textbook_read_rpc_unavailable" });
  assert.equal(missingCalls, 1);
});

test("taxonomy page accepts persisted, default, and added rows with global move availability", async () => {
  const { listTextbookSubSubjectPage } = await import(serviceUrl.href);
  const rows = [
    { id: id(1), subject: "other", name: "사용자 99", sortOrder: 990, isVisible: true, kind: "persisted", canMoveUp: true, canMoveDown: true },
    { id: "other-기타", subject: "other", name: "기타", sortOrder: 1000, isVisible: true, kind: "default", canMoveUp: true, canMoveDown: true },
    { id: id(2), subject: "other", name: "", sortOrder: 1010, isVisible: false, kind: "added", canMoveUp: true, canMoveDown: false },
  ];
  const client = { rpc() { return { abortSignal() { return this; }, retry() { return Promise.resolve({ data: envelope({ rows, totalCount: 103, subjectCounts: { english: 6, math: 9, science: 5, other: 103 } }), error: null }); } }; } };
  const page = await listTextbookSubSubjectPage(request(), { client });
  assert.deepEqual(page.rows, rows);
});

test("strict taxonomy parser rejects impossible counts, IDs, order metadata, and off-end rows", async () => {
  const { listTextbookSubSubjectPage } = await import(serviceUrl.href);
  const row = { id: id(3), subject: "other", name: "행", sortOrder: 10, isVisible: true, kind: "persisted", canMoveUp: false, canMoveDown: false };
  const client = (data) => ({ rpc() { return { abortSignal() { return this; }, retry() { return Promise.resolve({ data, error: null }); } }; } });
  for (const data of [
    envelope({ visibleCount: 122 }),
    envelope({ totalCount: 102 }),
    envelope({ rows: [row], totalCount: 100 }),
    envelope({ rows: [{ ...row, id: "not-a-uuid" }], totalCount: 101 }),
    envelope({ rows: [{ ...row, id: "other-기타", kind: "persisted" }], totalCount: 101 }),
    envelope({ rows: [{ ...row, subject: "english" }], totalCount: 101 }),
    envelope({ rows: [{ ...row, canMoveUp: true, canMoveDown: true }], totalCount: 101, subjectCounts: { english: 6, math: 9, science: 5, other: 1 } }),
  ]) await assert.rejects(() => listTextbookSubSubjectPage(request(), { client: client(data) }), /textbook_read_response_invalid/);
});

test("taxonomy request validates exact filters, draft, positive pages, and sizes 10/15/20", async () => {
  const { listTextbookSubSubjectPage } = await import(serviceUrl.href);
  const goodClient = (pageSize) => ({ rpc() { return { abortSignal() { return this; }, retry() { return Promise.resolve({ data: envelope({ pageSize }), error: null }); } }; } });
  for (const pageSize of [10, 15, 20]) {
    const result = await listTextbookSubSubjectPage(request({ pageSize }), { client: goodClient(pageSize) });
    assert.equal(result.pageSize, pageSize);
  }
  for (const invalid of [
    request({ page: 0 }),
    request({ pageSize: 5 }),
    request({ filters: { subject: "all", search: "" } }),
    request({ filters: { subject: "english", search: "", extra: true } }),
    { ...request(), extra: true },
    request({ draft: { version: 1, baseRevision: revision, operations: [], extra: true } }),
  ]) {
    let calls = 0;
    assert.throws(() => listTextbookSubSubjectPage(invalid, { client: { rpc() { calls += 1; throw new Error("must not call"); } } }), /textbook_read_input_invalid|textbook_settings_draft_invalid/);
    assert.equal(calls, 0);
  }
});

test("taxonomy read preserves caller cancellation before and after transport", async () => {
  const { listTextbookSubSubjectPage } = await import(serviceUrl.href);
  const before = new AbortController(); before.abort();
  let calls = 0;
  await assert.rejects(() => listTextbookSubSubjectPage(request(), { signal: before.signal, client: { rpc() { calls += 1; throw new Error("must not call"); } } }), { name: "AbortError" });
  assert.equal(calls, 0);
  const after = new AbortController();
  const late = { rpc() { return { abortSignal() { return this; }, retry() { after.abort(); return Promise.resolve({ data: envelope(), error: null }); } }; } };
  await assert.rejects(() => listTextbookSubSubjectPage(request(), { signal: after.signal, client: late }), { name: "AbortError" });
});
