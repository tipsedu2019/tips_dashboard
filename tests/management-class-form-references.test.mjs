import test from "node:test";
import assert from "node:assert/strict";
import { createManagementReadService } from "../src/features/management/management-service.js";

function clientFixture({ count = 0, response, scienceError } = {}) {
  const calls = [];
  const source = Array.from({ length: count }, (_, index) => ({
    id: String(index), name: `교사 ${index}`, subjects: ["영어팀"], is_visible: true, sort_order: index,
  }));
  const client = {
    from(table) {
      const call = { table }; calls.push(call);
      const query = {
        select(value) { call.select = value; return query; },
        eq(key, value) { call.filter = [key, value]; return query; },
        range(start, end) { call.range = [start, end]; return query; },
        limit(value) { call.limit = value; return query; },
        order(key) { (call.orders ||= []).push(key); return query; },
        abortSignal(value) { call.signal = value; return query; },
        retry(value) { call.retry = value; return query; },
        async then(resolve, reject) {
          try {
            const result = response ? await response(call) : { data: source.slice(call.range[0], call.range[1] + 1), error: null };
            return resolve(result);
          } catch (error) { return reject(error); }
        },
      }; return query;
    },
    rpc(name) {
      calls.push({ rpc: name });
      const query = { abortSignal() { return query; }, retry() { return Promise.resolve({ data: [], error: scienceError }); } };
      return query;
    },
  };
  return { calls, service: createManagementReadService({ supabase: client }) };
}

test("class form reads all visible catalog pages beyond 200, independent of existing classes", async () => {
  const { calls, service } = clientFixture({ count: 215 });
  const result = await service.loadClassFormReferences();
  assert.equal(result.teacherCatalogs.length, 215);
  assert.equal(result.classroomCatalogs.length, 215);
  assert.equal(result.teacherCatalogs.at(-1).id, "214");
  const reads = calls.filter(call => call.table);
  assert.equal(reads.length, 16);
  for (const call of reads) {
    assert.equal(call.select, "id, name, subjects, is_visible, sort_order");
    assert.deepEqual(call.filter, ["is_visible", true]);
    assert.equal(call.limit, 30);
    assert.equal(call.range[1] - call.range[0], 29);
    assert.deepEqual(call.orders, ["sort_order", "name", "id"]);
    assert.equal(call.retry, false);
    assert.equal(call.signal, reads[0].signal);
  }
  assert.deepEqual(calls.filter(call => call.rpc), [{ rpc: "list_active_science_subject_areas_v1" }]);
});

test("successful empty catalogs are distinct from read failures", async () => {
  const { service } = clientFixture();
  assert.deepEqual(await service.loadClassFormReferences(), { teacherCatalogs: [], classroomCatalogs: [], scienceSubjectAreas: [] });
  const error = new Error("denied");
  await assert.rejects(clientFixture({ response: () => ({ data: null, error }) }).service.loadClassFormReferences(), error);
  await assert.rejects(clientFixture({ scienceError: error }).service.loadClassFormReferences(), error);
});

test("later-page errors never publish a partial catalog", async () => {
  const { service } = clientFixture({ response: call => call.range[0] === 0
    ? { data: Array.from({ length: 30 }, (_, i) => ({ id: String(i) })) }
    : { error: new Error("second page unavailable") } });
  await assert.rejects(service.loadClassFormReferences(), /second page unavailable/);
});

test("invalid and overlapping pages fail closed", async () => {
  for (const data of [null, {}, [{ name: "missing id" }], [{ id: "same" }, { id: "same" }], Array.from({ length: 31 }, (_, i) => ({ id: String(i) }))]) {
    await assert.rejects(clientFixture({ response: () => ({ data }) }).service.loadClassFormReferences(), /class_catalog_page_/);
  }
  await assert.rejects(clientFixture({ response: () => ({ data: Array.from({ length: 30 }, (_, i) => ({ id: String(i) })) }) }).service.loadClassFormReferences(), /class_catalog_page_changed/);
});

test("closing a form aborts catalog reads even when transport delivers a late success", async () => {
  const controller = new AbortController();
  let resolve;
  const response = new Promise(done => { resolve = done; });
  const { service } = clientFixture({ response: () => response });
  const pending = service.loadClassFormReferences({ signal: controller.signal });
  controller.abort();
  resolve({ data: [{ id: "stale" }] });
  await assert.rejects(pending, { name: "AbortError" });
  const fresh = clientFixture();
  await assert.rejects(fresh.service.loadClassFormReferences({ signal: controller.signal }), { name: "AbortError" });
  assert.equal(fresh.calls.length, 0);
});
