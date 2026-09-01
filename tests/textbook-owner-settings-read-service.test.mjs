import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";

const feature = new URL("../src/features/textbooks/", import.meta.url);
const ownerServiceUrl = new URL(
  "../src/features/textbooks/textbook-owner-settings-service.ts",
  import.meta.url,
);
const draftServiceUrl = new URL(
  "../src/features/textbooks/textbook-settings-draft-service.ts",
  import.meta.url,
);
const id = (value) => `6a000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "@/lib/supabase" &&
      context.parentURL?.startsWith(feature.href)
    ) {
      return {
        url: 'data:text/javascript,export const supabase=null;export const supabaseConfigError="unconfigured";',
        shortCircuit: true,
      };
    }
    if (
      specifier.startsWith("./") &&
      context.parentURL?.startsWith(feature.href)
    ) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) {
        return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

test("owner settings strict service exports and calls every projected read method", async () => {
  assert.equal(
    existsSync(ownerServiceUrl),
    true,
    "textbook-owner-settings-service.ts must exist",
  );

  const service = await import(ownerServiceUrl.href);
  for (const method of [
    "listTextbookPublisherPage",
    "listTextbookSupplierPage",
    "listTextbookSupplierSettingPickerPage",
    "getTextbookPublisherSettingDetail",
    "getTextbookSupplierSettingDetail",
  ]) {
    assert.equal(typeof service[method], "function", `${method} must be exported`);
  }

  for (const [method, input] of [
    ["listTextbookPublisherPage", { page: 1, pageSize: 10, sort: "name", filters: { search: "" }, draft: null }],
    ["listTextbookSupplierPage", { page: 1, pageSize: 10, sort: "name", filters: { search: "" }, draft: null }],
    ["listTextbookSupplierSettingPickerPage", { page: 1, pageSize: 10, sort: "name", filters: { search: "" }, draft: null }],
    ["getTextbookPublisherSettingDetail", { id: id(1), draft: null }],
    ["getTextbookSupplierSettingDetail", { id: id(2), draft: null }],
  ]) {
    await assert.rejects(
      () => service[method](input),
      /unconfigured|unavailable/i,
      `${method} must use the real strict service boundary`,
    );
  }
});

test("owner settings strict draft service exports and calls the atomic save method", async () => {
  assert.equal(
    existsSync(draftServiceUrl),
    true,
    "textbook-settings-draft-service.ts must exist",
  );

  const service = await import(draftServiceUrl.href);
  assert.equal(
    typeof service.saveTextbookSettingsDraft,
    "function",
    "saveTextbookSettingsDraft must be exported",
  );
  await assert.rejects(
    () => service.saveTextbookSettingsDraft({
      requestId: id(3),
      draft: {
        version: 1,
        owners: { version: 1, baseRevision: "a".repeat(64), operations: [] },
        subSubjects: null,
      },
    }),
    /unconfigured|unavailable/i,
    "saveTextbookSettingsDraft must use the real strict service boundary",
  );
});

test("owner settings page transport sends draft through the exact RPC boundary", async () => {
  const service = await import(ownerServiceUrl.href);
  const calls = [];
  const client = { rpc(name, args) { calls.push({ name, args }); return { abortSignal() { return this; }, retry() { return Promise.resolve({ data: { rows: [{ id: id(91), name: "끝", subjects: [], suppliers: [], textbookCount: 0, isNew: false }], page: 11, pageSize: 10, totalCount: 101, baseRevision: "a".repeat(64), ownerCounts: { publishers: 101, suppliers: 0 } }, error: null }); } }; } };
  const page = await service.listTextbookPublisherPage({ page: 11, pageSize: 10, sort: "name", filters: { search: "" }, draft: null }, { client });
  assert.equal(page.totalCount, 101);
  assert.deepEqual(calls, [{ name: "list_textbook_publisher_page_v1", args: { p_filters: { search: "" }, p_draft: null, p_sort: "name", p_page: 11, p_page_size: 10 } }]);
});

test("supplier DTO keeps the first three publisher names as an array", async () => {
  const service = await import(ownerServiceUrl.href);
  const client = { rpc() { return { abortSignal() { return this; }, retry() { return Promise.resolve({ data: { rows: [{ id: id(200), name: "공급처", contact: "", memo: "", linkedPublisherCount: 4, linkedPublisherNames: ["출판사 1", "출판사 2", "출판사 10"], isNew: false }], page: 1, pageSize: 10, totalCount: 1, baseRevision: "a".repeat(64), ownerCounts: { publishers: 4, suppliers: 1 } }, error: null }); } }; } };
  const page = await service.listTextbookSupplierPage({ page: 1, pageSize: 10, sort: "name", filters: { search: "" }, draft: null }, { client });
  assert.deepEqual(page.rows[0].linkedPublisherNames, ["출판사 1", "출판사 2", "출판사 10"]);
});

test("supplier DTO requires exactly the first min(3, linkedPublisherCount) names", async () => {
  const service = await import(ownerServiceUrl.href);
  const request = { page: 1, pageSize: 10, sort: "name", filters: { search: "" }, draft: null };
  const response = row => ({ rows: [row], page: 1, pageSize: 10, totalCount: 1, baseRevision: "a".repeat(64), ownerCounts: { publishers: 4, suppliers: 1 } });
  const read = row => ({ rpc() { return { abortSignal() { return this; }, retry() { return Promise.resolve({ data: response(row), error: null }); } }; } });
  for (const [count, names] of [[0, []], [1, ["출판사 1"]], [3, ["출판사 1", "출판사 2", "출판사 3"]]]) {
    const page = await service.listTextbookSupplierPage(request, { client: read({ id: id(201 + count), name: "공급처", contact: "", memo: "", linkedPublisherCount: count, linkedPublisherNames: names, isNew: false }) });
    assert.deepEqual(page.rows[0].linkedPublisherNames, names);
  }
  await assert.rejects(() => service.listTextbookSupplierPage(request, { client: read({ id: id(205), name: "공급처", contact: "", memo: "", linkedPublisherCount: 4, linkedPublisherNames: ["출판사 1", "출판사 2"], isNew: false }) }), /textbook_read_response_invalid/);
});

test("strict page parser rejects duplicate rows and duplicate embedded supplier identities", async () => {
  const service = await import(ownerServiceUrl.href);
  const row = { id: id(220), name: "출판사", subjects: [], suppliers: [{ id: id(221), name: "공급처" }, { id: id(221), name: "중복" }], textbookCount: 0, isNew: false };
  const client = { rpc() { return { abortSignal() { return this; }, retry() { return Promise.resolve({ data: { rows: [row, { ...row, id: id(222) }], page: 1, pageSize: 10, totalCount: 2, baseRevision: "a".repeat(64), ownerCounts: { publishers: 2, suppliers: 1 } }, error: null }); } }; } };
  await assert.rejects(() => service.listTextbookPublisherPage({ page: 1, pageSize: 10, sort: "name", filters: { search: "" }, draft: null }, { client }), /textbook_read_response_invalid/);
});

test("owner reads use the five literal RPC contracts for every allowed page size and never fall back", async () => {
  const service = await import(ownerServiceUrl.href);
  const cases = [
    ["listTextbookPublisherPage", "list_textbook_publisher_page_v1", () => ({ id: id(301), name: "출판사", subjects: [], suppliers: [], textbookCount: 0, isNew: false })],
    ["listTextbookSupplierPage", "list_textbook_supplier_page_v1", () => ({ id: id(302), name: "공급처", contact: "", memo: "", linkedPublisherCount: 0, linkedPublisherNames: [], isNew: false })],
    ["listTextbookSupplierSettingPickerPage", "list_textbook_supplier_setting_picker_page_v1", () => ({ id: id(303), name: "공급처" })],
  ];
  for (const [method, rpc, row] of cases) {
    for (const pageSize of [10, 15, 20]) {
      const calls = [];
      const client = { rpc(name, args) { calls.push({ name, args }); return { abortSignal() { return this; }, retry(value) { assert.equal(value, false); return Promise.resolve({ data: { rows: [], page: 11, pageSize, totalCount: 0, baseRevision: "a".repeat(64), ownerCounts: { publishers: 0, suppliers: 0 } }, error: null }); } }; } };
      const request = { page: 11, pageSize, sort: "name", filters: { search: "" }, draft: null };
      assert.deepEqual(await service[method](request, { client }), { rows: [], page: 11, pageSize, totalCount: 0, baseRevision: "a".repeat(64), ownerCounts: { publishers: 0, suppliers: 0 } });
      assert.deepEqual(calls, [{ name: rpc, args: { p_filters: { search: "" }, p_draft: null, p_sort: "name", p_page: 11, p_page_size: pageSize } }]);
      const one = { rpc() { return { abortSignal() { return this; }, retry() { return Promise.resolve({ data: { rows: [row()], page: 11, pageSize, totalCount: 1, baseRevision: "a".repeat(64), ownerCounts: { publishers: 1, suppliers: 1 } }, error: null }); } }; } };
      await assert.rejects(() => service[method](request, { client: one }), /textbook_read_response_invalid/, "off-end pages cannot contain a row");
    }
    const missing = { calls: 0, rpc() { this.calls += 1; return { abortSignal() { return this; }, retry() { return Promise.resolve({ data: null, error: { code: "PGRST202" } }); } }; } };
    await assert.rejects(() => service[method]({ page: 1, pageSize: 10, sort: "name", filters: { search: "" }, draft: null }, { client: missing }), { code: "textbook_read_rpc_unavailable" });
    assert.equal(missing.calls, 1, "missing RPC must not try a catalog fallback");
  }
});

test("owner detail reads keep selected ID arguments and strict nested/count consistency", async () => {
  const service = await import(ownerServiceUrl.href);
  const cases = [
    ["getTextbookPublisherSettingDetail", "get_textbook_publisher_setting_detail_v1", id(401), { id: id(401), name: "출판사", subjects: [], suppliers: [], textbookCount: 0, isNew: false }],
    ["getTextbookSupplierSettingDetail", "get_textbook_supplier_setting_detail_v1", id(402), { id: id(402), name: "공급처", contact: "", memo: "", linkedPublisherCount: 1, linkedPublisherNames: ["출판사"], isNew: false }],
  ];
  for (const [method, rpc, selectedId, row] of cases) {
    const calls = [];
    const client = { rpc(name, args) { calls.push({ name, args }); return { abortSignal() { return this; }, retry(value) { assert.equal(value, false); return Promise.resolve({ data: { row, baseRevision: "b".repeat(64), ownerCounts: { publishers: 1, suppliers: 1 } }, error: null }); } }; } };
    const result = await service[method]({ id: selectedId, draft: null }, { client });
    assert.equal(result.row.id, selectedId);
    assert.deepEqual(calls, [{ name: rpc, args: { p_id: selectedId, p_draft: null } }]);
  }
  const inconsistent = { rpc() { return { abortSignal() { return this; }, retry() { return Promise.resolve({ data: { rows: [{ id: id(499), name: "공급처", contact: "", memo: "", linkedPublisherCount: 1, linkedPublisherNames: ["a", "b"], isNew: false }], page: 1, pageSize: 10, totalCount: 1, baseRevision: "a".repeat(64), ownerCounts: { publishers: 1, suppliers: 1 } }, error: null }); } }; } };
  await assert.rejects(() => service.listTextbookSupplierPage({ page: 1, pageSize: 10, sort: "name", filters: { search: "" }, draft: null }, { client: inconsistent }), /textbook_read_response_invalid/);
});

test("owner page/detail boundaries reject count contradictions and request shape drift", async () => {
  const service = await import(ownerServiceUrl.href);
  const publisher = { id: id(510), name: "출판사", subjects: [], suppliers: [], textbookCount: 0, isNew: false };
  const supplier = { id: id(511), name: "공급처", contact: "", memo: "", linkedPublisherCount: 0, linkedPublisherNames: [], isNew: false };
  const pageClient = data => ({ rpc() { return { abortSignal() { return this; }, retry() { return Promise.resolve({ data, error: null }); } }; } });
  const envelope = (rows, ownerCounts) => ({ rows, page: 1, pageSize: 10, totalCount: 1, baseRevision: "a".repeat(64), ownerCounts });
  const request = { page: 1, pageSize: 10, sort: "name", filters: { search: "" }, draft: null };
  await assert.rejects(() => service.listTextbookPublisherPage(request, { client: pageClient(envelope([publisher], { publishers: 0, suppliers: 1 })) }), /textbook_read_response_invalid/);
  await assert.rejects(() => service.listTextbookSupplierPage(request, { client: pageClient(envelope([supplier], { publishers: 1, suppliers: 0 })) }), /textbook_read_response_invalid/);
  await assert.rejects(() => service.listTextbookSupplierSettingPickerPage(request, { client: pageClient(envelope([{ id: supplier.id, name: supplier.name }], { publishers: 1, suppliers: 0 })) }), /textbook_read_response_invalid/);
  for (const [method, selectedId, row, ownerCounts] of [
    ["getTextbookPublisherSettingDetail", publisher.id, publisher, { publishers: 0, suppliers: 1 }],
    ["getTextbookSupplierSettingDetail", supplier.id, supplier, { publishers: 1, suppliers: 0 }],
  ]) await assert.rejects(() => service[method]({ id: selectedId, draft: null }, { client: pageClient({ row, baseRevision: "a".repeat(64), ownerCounts }) }), /textbook_read_response_invalid/);
  for (const invalid of [{ ...request, extra: true }, (() => { const copy = { ...request }; delete copy.draft; return copy; })()]) {
    let calls = 0;
    assert.throws(() => service.listTextbookPublisherPage(invalid, { client: { rpc() { calls += 1; throw new Error("must not call"); } } }), /textbook_read_input_invalid/);
    assert.equal(calls, 0);
  }
});

test("owner reads retain blank draft rows for page and selected-detail preview", async () => {
  const service = await import(ownerServiceUrl.href);
  const revision = "c".repeat(64);
  const publisherId = id(520);
  const supplierId = id(521);
  const publisherDraft = { version: 1, baseRevision: revision, operations: [
    { type: "publisher.add", id: publisherId, name: "", subjects: [], supplierIds: [] },
  ] };
  const supplierDraft = { version: 1, baseRevision: revision, operations: [
    { type: "supplier.add", id: supplierId, name: "   ", contact: "", memo: "" },
  ] };
  const publisher = { id: publisherId, name: "", subjects: [], suppliers: [], textbookCount: 0, isNew: true };
  const supplier = { id: supplierId, name: "", contact: "", memo: "", linkedPublisherCount: 0, linkedPublisherNames: [], isNew: true };
  const request = draft => ({ page: 1, pageSize: 10, sort: "name", filters: { search: "" }, draft });
  const pageClient = data => ({ rpc() { return { abortSignal() { return this; }, retry() { return Promise.resolve({ data, error: null }); } }; } });
  const publisherPage = await service.listTextbookPublisherPage(request(publisherDraft), { client: pageClient({ rows: [publisher], page: 1, pageSize: 10, totalCount: 1, baseRevision: revision, ownerCounts: { publishers: 1, suppliers: 0 } }) });
  assert.equal(publisherPage.rows[0].name, "");
  const publisherDetail = await service.getTextbookPublisherSettingDetail({ id: publisherId, draft: publisherDraft }, { client: pageClient({ row: publisher, baseRevision: revision, ownerCounts: { publishers: 1, suppliers: 0 } }) });
  assert.equal(publisherDetail.row.name, "");
  const supplierPage = await service.listTextbookSupplierPage(request(supplierDraft), { client: pageClient({ rows: [supplier], page: 1, pageSize: 10, totalCount: 1, baseRevision: revision, ownerCounts: { publishers: 0, suppliers: 1 } }) });
  assert.equal(supplierPage.rows[0].name, "");
  const supplierDetail = await service.getTextbookSupplierSettingDetail({ id: supplierId, draft: supplierDraft }, { client: pageClient({ row: supplier, baseRevision: revision, ownerCounts: { publishers: 0, suppliers: 1 } }) });
  assert.equal(supplierDetail.row.name, "");
});

test("owner page and detail parsers reject impossible relationship counts", async () => {
  const service = await import(ownerServiceUrl.href);
  const request = { page: 1, pageSize: 10, sort: "name", filters: { search: "" }, draft: null };
  const publisher = { id: id(530), name: "출판사", subjects: [], suppliers: [{ id: id(531), name: "공급처" }], textbookCount: 0, isNew: false };
  const supplier = { id: id(532), name: "공급처", contact: "", memo: "", linkedPublisherCount: 2, linkedPublisherNames: ["출판사 1", "출판사 2"], isNew: false };
  const client = data => ({ rpc() { return { abortSignal() { return this; }, retry() { return Promise.resolve({ data, error: null }); } }; } });
  for (const [method, data] of [
    ["listTextbookPublisherPage", { rows: [publisher], page: 1, pageSize: 10, totalCount: 1, baseRevision: "d".repeat(64), ownerCounts: { publishers: 1, suppliers: 0 } }],
    ["listTextbookSupplierPage", { rows: [supplier], page: 1, pageSize: 10, totalCount: 1, baseRevision: "d".repeat(64), ownerCounts: { publishers: 1, suppliers: 1 } }],
  ]) await assert.rejects(() => service[method](request, { client: client(data) }), /textbook_read_response_invalid/);
  for (const [method, selectedId, row, ownerCounts] of [
    ["getTextbookPublisherSettingDetail", publisher.id, publisher, { publishers: 1, suppliers: 0 }],
    ["getTextbookSupplierSettingDetail", supplier.id, supplier, { publishers: 1, suppliers: 1 }],
  ]) await assert.rejects(() => service[method]({ id: selectedId, draft: null }, { client: client({ row, baseRevision: "d".repeat(64), ownerCounts }) }), /textbook_read_response_invalid/);
});

test("owner reads respect a caller abort before transport and after an in-flight response", async () => {
  const service = await import(ownerServiceUrl.href);
  const input = { page: 1, pageSize: 10, sort: "name", filters: { search: "" }, draft: null };
  const before = new AbortController(); before.abort();
  let beforeCalls = 0;
  await assert.rejects(() => service.listTextbookPublisherPage(input, { signal: before.signal, client: { rpc() { beforeCalls += 1; throw new Error("must not call"); } } }), { name: "AbortError" });
  assert.equal(beforeCalls, 0);
  const after = new AbortController();
  const late = { calls: 0, rpc() { this.calls += 1; return { abortSignal() { return this; }, retry() { after.abort(); return Promise.resolve({ data: { rows: [], page: 1, pageSize: 10, totalCount: 0, baseRevision: "a".repeat(64), ownerCounts: { publishers: 0, suppliers: 0 } }, error: null }); } }; } };
  await assert.rejects(() => service.listTextbookPublisherPage(input, { signal: after.signal, client: late }), { name: "AbortError" });
  assert.equal(late.calls, 1);
});

test("all owner reads and save combine caller/deadline signals and honor eight-second pre and late aborts", async () => {
  const reads = await import(ownerServiceUrl.href);
  const drafts = await import(draftServiceUrl.href);
  const page = { page: 1, pageSize: 10, sort: "name", filters: { search: "" }, draft: null };
  const save = { requestId: id(601), draft: { version: 1, owners: { version: 1, baseRevision: "a".repeat(64), operations: [] }, subSubjects: null } };
  const emptyPage = { rows: [], page: 1, pageSize: 10, totalCount: 0, baseRevision: "a".repeat(64), ownerCounts: { publishers: 0, suppliers: 0 } };
  const cases = [
    [reads.listTextbookPublisherPage, page, emptyPage],
    [reads.listTextbookSupplierPage, page, emptyPage],
    [reads.listTextbookSupplierSettingPickerPage, page, emptyPage],
    [reads.getTextbookPublisherSettingDetail, { id: id(602), draft: null }, { row: null, baseRevision: "a".repeat(64), ownerCounts: { publishers: 0, suppliers: 0 } }],
    [reads.getTextbookSupplierSettingDetail, { id: id(603), draft: null }, { row: null, baseRevision: "a".repeat(64), ownerCounts: { publishers: 0, suppliers: 0 } }],
    [drafts.saveTextbookSettingsDraft, save, { requestId: save.requestId, owners: { baseRevision: "a".repeat(64), newRevision: "a".repeat(64), changedPublisherIds: [], deletedPublisherIds: [], changedSupplierIds: [], deletedSupplierIds: [], changedLinkPublisherIds: [] }, subSubjects: null }],
  ];
  const savedTimeout = AbortSignal.timeout;
  const deadlines = [];
  let abortOnCreate = false;
  try {
    AbortSignal.timeout = ms => { assert.equal(ms, 8000); const controller = new AbortController(); deadlines.push(controller); if (abortOnCreate) controller.abort(); return controller.signal; };
    for (const [method, input, data] of cases) {
      const caller = new AbortController();
      let suppliedSignal;
      const client = { rpc() { return { abortSignal(signal) { suppliedSignal = signal; return this; }, retry(value) { assert.equal(value, false); return Promise.resolve({ data, error: null }); } }; } };
      await method(input, { client, signal: caller.signal });
      assert.notEqual(suppliedSignal, caller.signal, "caller and deadline must be combined");
      assert.equal(suppliedSignal.aborted, false);
    }
    abortOnCreate = true;
    for (const [method, input] of cases) {
      let calls = 0;
      await assert.rejects(() => method(input, { client: { rpc() { calls += 1; throw new Error("must not send after deadline"); } } }), { name: "AbortError" });
      assert.equal(calls, 0);
    }
    abortOnCreate = false;
    for (const [method, input, data] of cases) {
      let calls = 0;
      const client = { rpc() { calls += 1; return { abortSignal() { return this; }, retry() { deadlines.at(-1).abort(); return Promise.resolve({ data, error: null }); } }; } };
      await assert.rejects(() => method(input, { client }), { name: "AbortError" });
      assert.equal(calls, 1);
    }
    assert.equal(deadlines.length, cases.length * 3);
  } finally {
    AbortSignal.timeout = savedTimeout;
  }
});
