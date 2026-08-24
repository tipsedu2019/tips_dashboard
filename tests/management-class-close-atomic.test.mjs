import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createManagementService } from "../src/features/management/management-service.js";

const CLASS_ID = "10000000-0000-4000-8000-000000000201";
const REQUEST_KEY = "20000000-0000-4000-8000-000000000201";

function makeClassCloseClient() {
  const calls = [];

  return {
    calls,
    from(table) {
      assert.equal(table, "classes");
      return {
        upsert(payload) {
          calls.push(["upsert", payload]);
          return {
            async select() {
              return { data: [{ ...payload }], error: null };
            },
          };
        },
        update() {
          throw new Error("raw class close invoked");
        },
      };
    },
    async rpc(name, args) {
      calls.push(["rpc", name, args]);
      return {
        data: {
          id: CLASS_ID,
          classId: CLASS_ID,
          status: "종강",
          removedStudentCount: 2,
        },
        error: null,
      };
    },
  };
}

test("saving a class as closed strips the raw status write and finishes through one roster RPC", async () => {
  const client = makeClassCloseClient();
  const service = createManagementService({
    supabase: client,
    generateId: () => REQUEST_KEY,
    probeRegistrationRuntime: async () => ({ mode: "ready", version: 1 }),
    refreshPublicClassesCache: async () => ({ status: "ready" }),
  });

  const result = await service.updateClass({
    id: CLASS_ID,
    name: "테스트",
    subject: "수학",
    grade: "중1",
    status: "종강",
    studentIds: ["student-1"],
    waitlistIds: ["student-2"],
  });

  assert.equal(result.status, "종강");
  assert.deepEqual(client.calls, [
    ["upsert", {
      id: CLASS_ID,
      name: "테스트",
      class_type: "정규",
      subject: "수학",
      subject_area_key: null,
      grade: "중1",
      teacher: "",
      schedule: "",
      room: "",
      capacity: 0,
      fee: 0,
      textbook_ids: [],
    }],
    ["rpc", "close_class_atomic_v1", {
      p_class_id: CLASS_ID,
      p_request_key: REQUEST_KEY,
    }],
  ]);
});

test("legacy class archive entry point also uses the atomic close RPC", async () => {
  const client = makeClassCloseClient();
  const service = createManagementService({
    supabase: client,
    generateId: () => REQUEST_KEY,
    refreshPublicClassesCache: async () => ({ status: "ready" }),
  });

  const result = await service.deleteClass(CLASS_ID);

  assert.equal(result.status, "종강");
  assert.deepEqual(client.calls, [["rpc", "close_class_atomic_v1", {
    p_class_id: CLASS_ID,
    p_request_key: REQUEST_KEY,
  }]]);
});

test("an ambiguous class close retry reuses the same request key", async () => {
  const rpcCalls = [];
  let generated = 0;
  const client = {
    async rpc(name, args) {
      rpcCalls.push([name, args]);
      if (rpcCalls.length === 1) {
        return { data: null, error: new Error("network response lost") };
      }
      return {
        data: { id: CLASS_ID, classId: CLASS_ID, status: "종강" },
        error: null,
      };
    },
  };
  const service = createManagementService({
    supabase: client,
    generateId: () => {
      generated += 1;
      return generated === 1
        ? "20000000-0000-4000-8000-000000000301"
        : "20000000-0000-4000-8000-000000000302";
    },
    refreshPublicClassesCache: async () => ({ status: "ready" }),
  });

  await assert.rejects(service.deleteClass(CLASS_ID), /network response lost/);
  const result = await service.deleteClass(CLASS_ID);

  assert.equal(result.status, "종강");
  assert.equal(generated, 1);
  assert.equal(rpcCalls.length, 2);
  assert.equal(rpcCalls[0][1].p_request_key, rpcCalls[1][1].p_request_key);
});

test("a post-close cache refresh retry replays the committed request key", async () => {
  const rpcCalls = [];
  let generated = 0;
  let refreshCalls = 0;
  const client = {
    async rpc(name, args) {
      rpcCalls.push([name, args]);
      return {
        data: { id: CLASS_ID, classId: CLASS_ID, status: "종강" },
        error: null,
      };
    },
  };
  const service = createManagementService({
    supabase: client,
    generateId: () => {
      generated += 1;
      return generated === 1
        ? "20000000-0000-4000-8000-000000000401"
        : "20000000-0000-4000-8000-000000000402";
    },
    refreshPublicClassesCache: async () => {
      refreshCalls += 1;
      if (refreshCalls === 1) throw new Error("cache refresh response lost");
      return { status: "ready" };
    },
  });

  await assert.rejects(service.deleteClass(CLASS_ID), /cache refresh response lost/);
  const result = await service.deleteClass(CLASS_ID);

  assert.equal(result.status, "종강");
  assert.equal(generated, 1);
  assert.equal(rpcCalls.length, 2);
  assert.equal(rpcCalls[0][1].p_request_key, rpcCalls[1][1].p_request_key);
});

test("a successful close keeps its receipt key for an outer workflow retry", async () => {
  const rpcCalls = [];
  let generated = 0;
  const client = {
    async rpc(name, args) {
      rpcCalls.push([name, args]);
      return {
        data: { id: CLASS_ID, classId: CLASS_ID, status: "종강" },
        error: null,
      };
    },
  };
  const service = createManagementService({
    supabase: client,
    generateId: () => {
      generated += 1;
      return generated === 1
        ? "20000000-0000-4000-8000-000000000501"
        : "20000000-0000-4000-8000-000000000502";
    },
    refreshPublicClassesCache: async () => ({ status: "ready" }),
  });

  await service.deleteClass(CLASS_ID);
  await service.deleteClass(CLASS_ID);

  assert.equal(generated, 1);
  assert.equal(rpcCalls.length, 2);
  assert.equal(rpcCalls[0][1].p_request_key, rpcCalls[1][1].p_request_key);
});

test("the detail save flow does not mutate class groups after the close commits", async () => {
  const pageSource = await readFile(
    new URL("../src/features/management/management-page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    pageSource,
    /if \(text\(\(updated as Record<string, unknown>\)\?\.status\) !== "종강"\) \{[\s\S]*?replaceClassGroupMemberships/,
  );
});
