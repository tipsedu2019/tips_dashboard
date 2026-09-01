import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const feature = new URL("../src/features/textbooks/", import.meta.url);
const pageServiceUrl = new URL("../src/features/textbooks/textbook-subsubject-service.ts", import.meta.url);
const saveServiceUrl = new URL("../src/features/textbooks/textbook-settings-draft-service.ts", import.meta.url);
const migrationUrl = new URL("../supabase/migrations/20260901072345_textbook_taxonomy_numbered_drafts.sql", import.meta.url);
const tapUrl = new URL("../supabase/tests/textbook_taxonomy_numbered_drafts_test.sql", import.meta.url);
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

// Untouched JSON from final request textbook-task6b-wire2; only
// "# TASK6B_WIRE " was removed. Final SQL log SHA-256:
// e0282c29644a21f2838ad3b310d79774fe35c3a0aee2e80946fe0c9e968a375d.
const finalTaxonomySqlWirePayloads = Object.freeze([
  "{\"data\": {\"page\": 11, \"rows\": [{\"id\": \"6f000000-0000-4000-8000-000000000101\", \"kind\": \"persisted\", \"name\": \"__task6b_wire__ 사용자 101\", \"subject\": \"other\", \"canMoveUp\": true, \"isVisible\": true, \"sortOrder\": 1110, \"canMoveDown\": true}, {\"id\": \"6f000000-0000-4000-8000-000000000102\", \"kind\": \"persisted\", \"name\": \"__task6b_wire__ 사용자 102\", \"subject\": \"other\", \"canMoveUp\": true, \"isVisible\": true, \"sortOrder\": 1120, \"canMoveDown\": true}, {\"id\": \"6f000000-0000-4000-8000-000000000103\", \"kind\": \"persisted\", \"name\": \"__task6b_wire__ 사용자 103\", \"subject\": \"other\", \"canMoveUp\": true, \"isVisible\": true, \"sortOrder\": 1130, \"canMoveDown\": true}, {\"id\": \"6f000000-0000-4000-8000-000000000104\", \"kind\": \"persisted\", \"name\": \"__task6b_wire__ 사용자 104\", \"subject\": \"other\", \"canMoveUp\": true, \"isVisible\": false, \"sortOrder\": 1140, \"canMoveDown\": true}, {\"id\": \"6f000000-0000-4000-8000-000000000105\", \"kind\": \"persisted\", \"name\": \"__task6b_wire__ 사용자 105\", \"subject\": \"other\", \"canMoveUp\": true, \"isVisible\": true, \"sortOrder\": 1150, \"canMoveDown\": true}, {\"id\": \"6f000000-0000-4000-8000-000000000106\", \"kind\": \"persisted\", \"name\": \"__task6b_wire__ 사용자 106\", \"subject\": \"other\", \"canMoveUp\": true, \"isVisible\": true, \"sortOrder\": 1160, \"canMoveDown\": true}, {\"id\": \"6f000000-0000-4000-8000-000000000107\", \"kind\": \"persisted\", \"name\": \"__task6b_wire__ 사용자 107\", \"subject\": \"other\", \"canMoveUp\": true, \"isVisible\": true, \"sortOrder\": 1170, \"canMoveDown\": true}, {\"id\": \"6f000000-0000-4000-8000-000000000108\", \"kind\": \"persisted\", \"name\": \"__task6b_wire__ 사용자 108\", \"subject\": \"other\", \"canMoveUp\": true, \"isVisible\": false, \"sortOrder\": 1180, \"canMoveDown\": true}, {\"id\": \"6f000000-0000-4000-8000-000000000109\", \"kind\": \"persisted\", \"name\": \"__task6b_wire__ 사용자 109\", \"subject\": \"other\", \"canMoveUp\": true, \"isVisible\": true, \"sortOrder\": 1190, \"canMoveDown\": true}, {\"id\": \"6f000000-0000-4000-8000-000000000110\", \"kind\": \"persisted\", \"name\": \"__task6b_wire__ 사용자 110\", \"subject\": \"other\", \"canMoveUp\": true, \"isVisible\": true, \"sortOrder\": 1200, \"canMoveDown\": true}], \"pageSize\": 10, \"totalCount\": 112, \"baseRevision\": \"ebe68743811bfa3ce16dda8a71f23a5f5388f9331089cb0575f732881ac74c63\", \"visibleCount\": 105, \"subjectCounts\": {\"math\": 9, \"other\": 113, \"english\": 6, \"science\": 5}}, \"input\": {\"page\": 11, \"draft\": null, \"filters\": {\"search\": \"__task6b_wire__\", \"subject\": \"other\"}, \"pageSize\": 10}, \"method\": \"listTextbookSubSubjectPage\", \"actorId\": \"6f000000-0000-4000-8000-000000000901\"}",
  "{\"data\": {\"page\": 11, \"rows\": [{\"id\": \"6f000000-0000-4000-8000-000000000101\", \"kind\": \"persisted\", \"name\": \"__task6b_wire__ 사용자 101\", \"subject\": \"other\", \"canMoveUp\": true, \"isVisible\": true, \"sortOrder\": 1110, \"canMoveDown\": true}, {\"id\": \"6f000000-0000-4000-8000-000000000102\", \"kind\": \"persisted\", \"name\": \"__task6b_wire__ 사용자 102\", \"subject\": \"other\", \"canMoveUp\": true, \"isVisible\": true, \"sortOrder\": 1120, \"canMoveDown\": true}, {\"id\": \"6f000000-0000-4000-8000-000000000103\", \"kind\": \"persisted\", \"name\": \"__task6b_wire__ 사용자 103\", \"subject\": \"other\", \"canMoveUp\": true, \"isVisible\": true, \"sortOrder\": 1130, \"canMoveDown\": true}, {\"id\": \"6f000000-0000-4000-8000-000000000104\", \"kind\": \"persisted\", \"name\": \"__task6b_wire__ 사용자 104\", \"subject\": \"other\", \"canMoveUp\": true, \"isVisible\": false, \"sortOrder\": 1140, \"canMoveDown\": true}, {\"id\": \"6f000000-0000-4000-8000-000000000105\", \"kind\": \"persisted\", \"name\": \"__task6b_wire__ 사용자 105\", \"subject\": \"other\", \"canMoveUp\": true, \"isVisible\": true, \"sortOrder\": 1150, \"canMoveDown\": true}, {\"id\": \"6f000000-0000-4000-8000-000000000106\", \"kind\": \"persisted\", \"name\": \"__task6b_wire__ 사용자 106\", \"subject\": \"other\", \"canMoveUp\": true, \"isVisible\": true, \"sortOrder\": 1160, \"canMoveDown\": true}, {\"id\": \"6f000000-0000-4000-8000-000000000107\", \"kind\": \"persisted\", \"name\": \"__task6b_wire__ 사용자 107\", \"subject\": \"other\", \"canMoveUp\": true, \"isVisible\": true, \"sortOrder\": 1170, \"canMoveDown\": true}, {\"id\": \"6f000000-0000-4000-8000-000000000108\", \"kind\": \"persisted\", \"name\": \"__task6b_wire__ 사용자 108\", \"subject\": \"other\", \"canMoveUp\": true, \"isVisible\": false, \"sortOrder\": 1180, \"canMoveDown\": true}, {\"id\": \"6f000000-0000-4000-8000-000000000109\", \"kind\": \"persisted\", \"name\": \"__task6b_wire__ 사용자 109\", \"subject\": \"other\", \"canMoveUp\": true, \"isVisible\": true, \"sortOrder\": 1190, \"canMoveDown\": true}, {\"id\": \"6f000000-0000-4000-8000-000000000110\", \"kind\": \"persisted\", \"name\": \"__task6b_wire__ 사용자 110\", \"subject\": \"other\", \"canMoveUp\": true, \"isVisible\": true, \"sortOrder\": 1200, \"canMoveDown\": true}], \"pageSize\": 10, \"totalCount\": 113, \"baseRevision\": \"ebe68743811bfa3ce16dda8a71f23a5f5388f9331089cb0575f732881ac74c63\", \"visibleCount\": 106, \"subjectCounts\": {\"math\": 9, \"other\": 114, \"english\": 6, \"science\": 5}}, \"input\": {\"page\": 11, \"draft\": {\"version\": 1, \"operations\": [{\"id\": \"6f000000-0000-4000-8000-000000000800\", \"name\": \"__task6b_wire__ 추가\", \"type\": \"add\", \"subject\": \"other\", \"isVisible\": true}, {\"id\": \"6f000000-0000-4000-8000-000000000100\", \"type\": \"move\", \"direction\": \"up\"}], \"baseRevision\": \"ebe68743811bfa3ce16dda8a71f23a5f5388f9331089cb0575f732881ac74c63\"}, \"filters\": {\"search\": \"__task6b_wire__\", \"subject\": \"other\"}, \"pageSize\": 10}, \"method\": \"listTextbookSubSubjectPage\", \"actorId\": \"6f000000-0000-4000-8000-000000000901\"}",
  "{\"data\": {\"owners\": null, \"requestId\": \"6f000000-0000-4000-8000-000000009001\", \"subSubjects\": {\"changedIds\": [\"252dd56f-6f3b-4d08-9215-3726ee107bb0\"], \"deletedIds\": [], \"newRevision\": \"2eab498342cd505bf1e9e360463c53d518be733042ed7facb6554a412222521e\", \"baseRevision\": \"ebe68743811bfa3ce16dda8a71f23a5f5388f9331089cb0575f732881ac74c63\", \"materializedIds\": {\"english-독해\": \"252dd56f-6f3b-4d08-9215-3726ee107bb0\"}}}, \"input\": {\"draft\": {\"owners\": null, \"version\": 1, \"subSubjects\": {\"version\": 1, \"operations\": [{\"id\": \"english-독해\", \"type\": \"patch\", \"patch\": {\"name\": \"__task6b_wire__ 독해 심화\", \"isVisible\": true}}], \"baseRevision\": \"ebe68743811bfa3ce16dda8a71f23a5f5388f9331089cb0575f732881ac74c63\"}}, \"requestId\": \"6f000000-0000-4000-8000-000000009001\"}, \"phase\": \"taxonomy-first\", \"method\": \"saveTextbookSettingsDraft\", \"actorId\": \"6f000000-0000-4000-8000-000000000901\"}",
  "{\"data\": {\"owners\": null, \"requestId\": \"6f000000-0000-4000-8000-000000009001\", \"subSubjects\": {\"changedIds\": [\"252dd56f-6f3b-4d08-9215-3726ee107bb0\"], \"deletedIds\": [], \"newRevision\": \"2eab498342cd505bf1e9e360463c53d518be733042ed7facb6554a412222521e\", \"baseRevision\": \"ebe68743811bfa3ce16dda8a71f23a5f5388f9331089cb0575f732881ac74c63\", \"materializedIds\": {\"english-독해\": \"252dd56f-6f3b-4d08-9215-3726ee107bb0\"}}}, \"input\": {\"draft\": {\"owners\": null, \"version\": 1, \"subSubjects\": {\"version\": 1, \"operations\": [{\"id\": \"english-독해\", \"type\": \"patch\", \"patch\": {\"name\": \"__task6b_wire__ 독해 심화\", \"isVisible\": true}}], \"baseRevision\": \"ebe68743811bfa3ce16dda8a71f23a5f5388f9331089cb0575f732881ac74c63\"}}, \"requestId\": \"6f000000-0000-4000-8000-000000009001\"}, \"phase\": \"taxonomy-replay\", \"method\": \"saveTextbookSettingsDraft\", \"actorId\": \"6f000000-0000-4000-8000-000000000901\"}",
  "{\"data\": {\"owners\": {\"newRevision\": \"0b32b3a2bc804777db7fe6615b2c2c2e9590978d4286c485a59ced7355068ce3\", \"baseRevision\": \"d274fb942346112730a7057ec53932f2bac3cb62ae89d32d3dae39aebacf2916\", \"changedSupplierIds\": [], \"deletedSupplierIds\": [], \"changedPublisherIds\": [\"6f000000-0000-4000-8000-000000000701\"], \"deletedPublisherIds\": [], \"changedLinkPublisherIds\": []}, \"requestId\": \"6f000000-0000-4000-8000-000000009002\", \"subSubjects\": {\"changedIds\": [\"6f000000-0000-4000-8000-000000000702\"], \"deletedIds\": [], \"newRevision\": \"230d6d1ba75af1c2c7e5251639b548549dc32118b5e64ae8e4fca70fd34796fe\", \"baseRevision\": \"2eab498342cd505bf1e9e360463c53d518be733042ed7facb6554a412222521e\", \"materializedIds\": {}}}, \"input\": {\"draft\": {\"owners\": {\"version\": 1, \"operations\": [{\"id\": \"6f000000-0000-4000-8000-000000000701\", \"name\": \"__task6b_wire__ 혼합 출판사\", \"type\": \"publisher.add\", \"subjects\": [\"english\"], \"supplierIds\": []}], \"baseRevision\": \"d274fb942346112730a7057ec53932f2bac3cb62ae89d32d3dae39aebacf2916\"}, \"version\": 1, \"subSubjects\": {\"version\": 1, \"operations\": [{\"id\": \"6f000000-0000-4000-8000-000000000702\", \"name\": \"__task6b_wire__ 혼합 세부과목\", \"type\": \"add\", \"subject\": \"other\", \"isVisible\": true}], \"baseRevision\": \"2eab498342cd505bf1e9e360463c53d518be733042ed7facb6554a412222521e\"}}, \"requestId\": \"6f000000-0000-4000-8000-000000009002\"}, \"phase\": \"mixed-first\", \"method\": \"saveTextbookSettingsDraft\", \"actorId\": \"6f000000-0000-4000-8000-000000000901\"}",
  "{\"data\": {\"owners\": {\"newRevision\": \"0b32b3a2bc804777db7fe6615b2c2c2e9590978d4286c485a59ced7355068ce3\", \"baseRevision\": \"d274fb942346112730a7057ec53932f2bac3cb62ae89d32d3dae39aebacf2916\", \"changedSupplierIds\": [], \"deletedSupplierIds\": [], \"changedPublisherIds\": [\"6f000000-0000-4000-8000-000000000701\"], \"deletedPublisherIds\": [], \"changedLinkPublisherIds\": []}, \"requestId\": \"6f000000-0000-4000-8000-000000009002\", \"subSubjects\": {\"changedIds\": [\"6f000000-0000-4000-8000-000000000702\"], \"deletedIds\": [], \"newRevision\": \"230d6d1ba75af1c2c7e5251639b548549dc32118b5e64ae8e4fca70fd34796fe\", \"baseRevision\": \"2eab498342cd505bf1e9e360463c53d518be733042ed7facb6554a412222521e\", \"materializedIds\": {}}}, \"input\": {\"draft\": {\"owners\": {\"version\": 1, \"operations\": [{\"id\": \"6f000000-0000-4000-8000-000000000701\", \"name\": \"__task6b_wire__ 혼합 출판사\", \"type\": \"publisher.add\", \"subjects\": [\"english\"], \"supplierIds\": []}], \"baseRevision\": \"d274fb942346112730a7057ec53932f2bac3cb62ae89d32d3dae39aebacf2916\"}, \"version\": 1, \"subSubjects\": {\"version\": 1, \"operations\": [{\"id\": \"6f000000-0000-4000-8000-000000000702\", \"name\": \"__task6b_wire__ 혼합 세부과목\", \"type\": \"add\", \"subject\": \"other\", \"isVisible\": true}], \"baseRevision\": \"2eab498342cd505bf1e9e360463c53d518be733042ed7facb6554a412222521e\"}}, \"requestId\": \"6f000000-0000-4000-8000-000000009002\"}, \"phase\": \"mixed-replay\", \"method\": \"saveTextbookSettingsDraft\", \"actorId\": \"6f000000-0000-4000-8000-000000000901\"}",
]);

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
test("Task6b immutable final artifacts bind the six original wire payloads", () => {
  assert.equal(sha256(readFileSync(migrationUrl)), "d22d9ac3a9656c92b9d2cb6978e49ad5ec6fec3955b0d095c4ee33214c3a3c26");
  assert.equal(sha256(readFileSync(tapUrl)), "2423547bea88e72e6668834b8286302d214dcdde0b5df6c1ba3048bdc17bbf9e");
  assert.equal(sha256(readFileSync(manifestUrl)), "468fb430635df8e17f915374bdf6e12eb07b75902ea06e01572787566484600b");
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));
  assert.deepEqual(manifest.orderedNewMigrations.find(entry => entry.fileName === "20260901072345_textbook_taxonomy_numbered_drafts.sql"), {
    fileName: "20260901072345_textbook_taxonomy_numbered_drafts.sql",
    status: "final",
    sha256: "d22d9ac3a9656c92b9d2cb6978e49ad5ec6fec3955b0d095c4ee33214c3a3c26",
  });
  assert.equal(finalTaxonomySqlWirePayloads.length, 6);
  assert.equal(sha256(finalTaxonomySqlWirePayloads.join("\n")), "d4da0264b87a2edb14513e7cf8dbac1e0e8cebe5114c26c5598f1143dfdeadcf");

  const captures = finalTaxonomySqlWirePayloads.map((payload) => {
    assert.ok(payload.length + "# TASK6B_WIRE ".length <= 8000);
    assert.doesNotMatch(payload, /\[redacted/i);
    const capture = JSON.parse(payload);
    assert.equal(capture.actorId, "6f000000-0000-4000-8000-000000000901");
    return capture;
  });
  assert.deepEqual(captures.map(capture => capture.method), [
    "listTextbookSubSubjectPage",
    "listTextbookSubSubjectPage",
    "saveTextbookSettingsDraft",
    "saveTextbookSettingsDraft",
    "saveTextbookSettingsDraft",
    "saveTextbookSettingsDraft",
  ]);
  assert.equal(captures[0].input.page, 11);
  assert.equal(captures[0].data.rows.length, 10);
  assert.equal(captures[0].data.totalCount, 112);
  assert.equal(captures[1].data.rows.length, 10);
  assert.equal(captures[1].data.totalCount, 113);
  assert.equal(captures[1].data.subjectCounts.other, 114);
  assert.deepEqual(captures[3].input, captures[2].input);
  assert.deepEqual(captures[3].data, captures[2].data);
  assert.deepEqual(captures[5].input, captures[4].input);
  assert.deepEqual(captures[5].data, captures[4].data);
  const materializedId = captures[2].data.subSubjects.materializedIds["english-독해"];
  assert.equal(captures[2].data.subSubjects.changedIds[0], materializedId);
  assert.deepEqual(captures[4].data.owners.changedPublisherIds, ["6f000000-0000-4000-8000-000000000701"]);
  assert.deepEqual(captures[4].data.subSubjects.changedIds, ["6f000000-0000-4000-8000-000000000702"]);
});

for (const [index, payload] of finalTaxonomySqlWirePayloads.entries()) {
  const capture = JSON.parse(payload);
  test(`Task6b original wire ${index + 1} passes actual ${capture.method} parser without repair`, async () => {
    const api = capture.method === "listTextbookSubSubjectPage"
      ? await import(pageServiceUrl.href)
      : await import(saveServiceUrl.href);
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
    if (capture.method === "listTextbookSubSubjectPage") {
      assert.equal(call.name, "list_textbook_sub_subject_numbered_page_v1");
      assert.deepEqual(call.args, {
        p_filters: capture.input.filters,
        p_draft: capture.input.draft,
        p_page: capture.input.page,
        p_page_size: capture.input.pageSize,
      });
    } else {
      assert.equal(call.name, "save_textbook_settings_draft_v1");
      assert.deepEqual(call.args, {
        p_request_id: capture.input.requestId,
        p_draft: capture.input.draft,
      });
    }
  });
}
