import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const feature = new URL("../src/features/textbooks/", import.meta.url);
const readServiceUrl = new URL("../src/features/textbooks/textbook-owner-settings-service.ts", import.meta.url);
const saveServiceUrl = new URL("../src/features/textbooks/textbook-settings-draft-service.ts", import.meta.url);
const migrationUrl = new URL("../supabase/migrations/20260901045629_textbook_supplier_numbered_reads.sql", import.meta.url);
const tapUrl = new URL("../supabase/tests/textbook_supplier_numbered_reads_test.sql", import.meta.url);
const manifestUrl = new URL("../supabase/test-baselines/dashboard-free-tier-v1.manifest.json", import.meta.url);
const sha256 = value => createHash("sha256").update(value).digest("hex");

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

// Exact original JSON from request textbook-task6a-wire2, authenticated actor
// 6b000000-0000-4000-8000-000000000901. Only "# TASK6A_WIRE " was removed.
// Final-only SQL log SHA-256: 51d6e01f0fb9aa81e4f9284dcddfb58885f228f593fb90cebb70bf151584a827.
const finalOwnerSettingsSqlWirePayloads = Object.freeze([
  String.raw`{"data": {"page": 1, "rows": [{"id": "6b000000-0000-4000-8000-000000000001", "name": "__task6a_wire__ 출판사 1", "isNew": false, "subjects": ["english"], "suppliers": [{"id": "6b000000-0000-4000-8000-000000000101", "name": "__task6a_wire__ 공급처 1"}, {"id": "6b000000-0000-4000-8000-000000000102", "name": "__task6a_wire__ 공급처 2"}], "textbookCount": 0}, {"id": "6b000000-0000-4000-8000-000000000002", "name": "__task6a_wire__ 출판사 2", "isNew": false, "subjects": ["math"], "suppliers": [{"id": "6b000000-0000-4000-8000-000000000101", "name": "__task6a_wire__ 공급처 1"}], "textbookCount": 0}], "pageSize": 10, "totalCount": 2, "ownerCounts": {"suppliers": 2, "publishers": 2}, "baseRevision": "5867edb30925b3c13e38347bdff6f06ab345ecaffe4487b048416d2925bd94ef"}, "input": {"page": 1, "sort": "name", "draft": null, "filters": {"search": "__task6a_wire__"}, "pageSize": 10}, "method": "listTextbookPublisherPage", "actorId": "6b000000-0000-4000-8000-000000000901"}`,
  String.raw`{"data": {"page": 1, "rows": [{"id": "6b000000-0000-4000-8000-000000000101", "memo": "직거래", "name": "__task6a_wire__ 공급처 1", "isNew": false, "contact": "02-000-0001", "linkedPublisherCount": 2, "linkedPublisherNames": ["__task6a_wire__ 출판사 1", "__task6a_wire__ 출판사 2"]}, {"id": "6b000000-0000-4000-8000-000000000102", "memo": "총판", "name": "__task6a_wire__ 공급처 2", "isNew": false, "contact": "02-000-0002", "linkedPublisherCount": 1, "linkedPublisherNames": ["__task6a_wire__ 출판사 1"]}], "pageSize": 10, "totalCount": 2, "ownerCounts": {"suppliers": 2, "publishers": 2}, "baseRevision": "5867edb30925b3c13e38347bdff6f06ab345ecaffe4487b048416d2925bd94ef"}, "input": {"page": 1, "sort": "name", "draft": null, "filters": {"search": "__task6a_wire__"}, "pageSize": 10}, "method": "listTextbookSupplierPage", "actorId": "6b000000-0000-4000-8000-000000000901"}`,
  String.raw`{"data": {"page": 1, "rows": [{"id": "6b000000-0000-4000-8000-000000000101", "name": "__task6a_wire__ 공급처 1"}, {"id": "6b000000-0000-4000-8000-000000000102", "name": "__task6a_wire__ 공급처 2"}], "pageSize": 10, "totalCount": 2, "ownerCounts": {"suppliers": 2, "publishers": 2}, "baseRevision": "5867edb30925b3c13e38347bdff6f06ab345ecaffe4487b048416d2925bd94ef"}, "input": {"page": 1, "sort": "name", "draft": null, "filters": {"search": "__task6a_wire__"}, "pageSize": 10}, "method": "listTextbookSupplierSettingPickerPage", "actorId": "6b000000-0000-4000-8000-000000000901"}`,
  String.raw`{"data": {"row": {"id": "6b000000-0000-4000-8000-000000000001", "name": "__task6a_wire__ 출판사 1", "isNew": false, "subjects": ["english"], "suppliers": [{"id": "6b000000-0000-4000-8000-000000000101", "name": "__task6a_wire__ 공급처 1"}, {"id": "6b000000-0000-4000-8000-000000000102", "name": "__task6a_wire__ 공급처 2"}], "textbookCount": 0}, "ownerCounts": {"suppliers": 2, "publishers": 2}, "baseRevision": "5867edb30925b3c13e38347bdff6f06ab345ecaffe4487b048416d2925bd94ef"}, "input": {"id": "6b000000-0000-4000-8000-000000000001", "draft": null}, "method": "getTextbookPublisherSettingDetail", "actorId": "6b000000-0000-4000-8000-000000000901"}`,
  String.raw`{"data": {"row": {"id": "6b000000-0000-4000-8000-000000000101", "memo": "직거래", "name": "__task6a_wire__ 공급처 1", "isNew": false, "contact": "02-000-0001", "linkedPublisherCount": 2, "linkedPublisherNames": ["__task6a_wire__ 출판사 1", "__task6a_wire__ 출판사 2"]}, "ownerCounts": {"suppliers": 2, "publishers": 2}, "baseRevision": "5867edb30925b3c13e38347bdff6f06ab345ecaffe4487b048416d2925bd94ef"}, "input": {"id": "6b000000-0000-4000-8000-000000000101", "draft": null}, "method": "getTextbookSupplierSettingDetail", "actorId": "6b000000-0000-4000-8000-000000000901"}`,
  String.raw`{"data": {"owners": {"newRevision": "5867edb30925b3c13e38347bdff6f06ab345ecaffe4487b048416d2925bd94ef", "baseRevision": "5867edb30925b3c13e38347bdff6f06ab345ecaffe4487b048416d2925bd94ef", "changedSupplierIds": [], "deletedSupplierIds": [], "changedPublisherIds": [], "deletedPublisherIds": [], "changedLinkPublisherIds": []}, "requestId": "6b000000-0000-4000-8000-000000009001", "subSubjects": null}, "input": {"draft": {"owners": {"version": 1, "operations": [], "baseRevision": "5867edb30925b3c13e38347bdff6f06ab345ecaffe4487b048416d2925bd94ef"}, "version": 1, "subSubjects": null}, "requestId": "6b000000-0000-4000-8000-000000009001"}, "phase": "first", "method": "saveTextbookSettingsDraft", "actorId": "6b000000-0000-4000-8000-000000000901"}`,
  String.raw`{"data": {"owners": {"newRevision": "5867edb30925b3c13e38347bdff6f06ab345ecaffe4487b048416d2925bd94ef", "baseRevision": "5867edb30925b3c13e38347bdff6f06ab345ecaffe4487b048416d2925bd94ef", "changedSupplierIds": [], "deletedSupplierIds": [], "changedPublisherIds": [], "deletedPublisherIds": [], "changedLinkPublisherIds": []}, "requestId": "6b000000-0000-4000-8000-000000009001", "subSubjects": null}, "input": {"draft": {"owners": {"version": 1, "operations": [], "baseRevision": "5867edb30925b3c13e38347bdff6f06ab345ecaffe4487b048416d2925bd94ef"}, "version": 1, "subSubjects": null}, "requestId": "6b000000-0000-4000-8000-000000009001"}, "phase": "replay", "method": "saveTextbookSettingsDraft", "actorId": "6b000000-0000-4000-8000-000000000901"}`,
]);

const pageRpcs = {
  listTextbookPublisherPage: "list_textbook_publisher_page_v1",
  listTextbookSupplierPage: "list_textbook_supplier_page_v1",
  listTextbookSupplierSettingPickerPage: "list_textbook_supplier_setting_picker_page_v1",
};
const detailRpcs = {
  getTextbookPublisherSettingDetail: "get_textbook_publisher_setting_detail_v1",
  getTextbookSupplierSettingDetail: "get_textbook_supplier_setting_detail_v1",
};

function wire(data) {
  const calls = [];
  const client = {
    rpc(name, args) {
      const call = { name, args, signal: null, retry: null };
      calls.push(call);
      return {
        abortSignal(signal) { call.signal = signal; return this; },
        retry(value) { call.retry = value; return Promise.resolve({ data, error: null }); },
      };
    },
  };
  return { calls, client };
}

test("Task6a immutable final artifacts bind all seven original wire payloads", () => {
  assert.equal(sha256(readFileSync(migrationUrl)), "f2df2c48c4959cf3c03e763d16002677a8359bb9f705f5b6c7f6d830b7c6e637");
  assert.equal(sha256(readFileSync(tapUrl)), "c9034ac4f989fba745cbcd4a4bcee11fa94b501826ac0374b3d3f5b5a5459e83");
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));
  assert.deepEqual(manifest.orderedNewMigrations.find(entry => entry.fileName === "20260901045629_textbook_supplier_numbered_reads.sql"), {
    fileName: "20260901045629_textbook_supplier_numbered_reads.sql",
    status: "final",
    sha256: "f2df2c48c4959cf3c03e763d16002677a8359bb9f705f5b6c7f6d830b7c6e637",
  });
  assert.equal(finalOwnerSettingsSqlWirePayloads.length, 7);
  assert.equal(sha256(finalOwnerSettingsSqlWirePayloads.join("\n")), "7aec7409e3391e35df7a65e406207ebf0f1acf4bdfc6f7958dce3d166162ccf8");
  const captures = finalOwnerSettingsSqlWirePayloads.map(payload => {
    assert.ok(payload.length + "# TASK6A_WIRE ".length <= 8000);
    assert.doesNotMatch(payload, /\[redacted/i);
    const capture = JSON.parse(payload);
    assert.equal(capture.actorId, "6b000000-0000-4000-8000-000000000901");
    return capture;
  });
  assert.deepEqual([...new Set(captures.map(capture => capture.method))].sort(), [
    ...Object.keys(pageRpcs), ...Object.keys(detailRpcs), "saveTextbookSettingsDraft",
  ].sort());
  assert.equal(captures[5].phase, "first");
  assert.equal(captures[6].phase, "replay");
  assert.deepEqual(captures[6].input, captures[5].input);
  assert.deepEqual(captures[6].data, captures[5].data);
});

for (const [index, payload] of finalOwnerSettingsSqlWirePayloads.entries()) {
  const capture = JSON.parse(payload);
  test(`Task6a original wire ${index + 1} passes actual ${capture.method} parser without repair`, async () => {
    const api = capture.method === "saveTextbookSettingsDraft"
      ? await import(saveServiceUrl.href)
      : await import(readServiceUrl.href);
    const original = structuredClone(capture.data);
    const before = JSON.stringify(capture.data);
    const transport = wire(capture.data);
    const result = await api[capture.method](capture.input, { client: transport.client });
    assert.equal(JSON.stringify(capture.data), before, "captured SQL data must remain byte-equivalent in memory");
    assert.deepEqual(capture.data, original, "service must not repair the captured DTO");
    assert.deepEqual(result, original);
    assert.equal(transport.calls.length, 1);
    const call = transport.calls[0];
    assert.equal(call.retry, false);
    assert.ok(call.signal instanceof AbortSignal);
    if (pageRpcs[capture.method]) {
      assert.equal(call.name, pageRpcs[capture.method]);
      assert.deepEqual(call.args, {
        p_filters: capture.input.filters,
        p_draft: capture.input.draft,
        p_sort: capture.input.sort,
        p_page: capture.input.page,
        p_page_size: capture.input.pageSize,
      });
    } else if (detailRpcs[capture.method]) {
      assert.equal(call.name, detailRpcs[capture.method]);
      assert.deepEqual(call.args, { p_id: capture.input.id, p_draft: capture.input.draft });
    } else {
      assert.equal(call.name, "save_textbook_settings_draft_v1");
      assert.deepEqual(call.args, { p_request_id: capture.input.requestId, p_draft: capture.input.draft });
    }
  });
}
