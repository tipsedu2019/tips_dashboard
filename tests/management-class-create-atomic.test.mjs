import test from "node:test";
import assert from "node:assert/strict";

import { createManagementService } from "../src/features/management/management-service.js";

const CLASS_ID = "10000000-0000-4000-8000-000000000101";
const GROUP_IDS = [
  "20000000-0000-4000-8000-000000000101",
  "20000000-0000-4000-8000-000000000102",
];

function makeAtomicClassCreateClient() {
  const calls = [];

  return {
    calls,
    from() {
      throw new Error("direct class write invoked");
    },
    async rpc(name, args) {
      calls.push([name, args]);
      return {
        data: {
          id: CLASS_ID,
          name: "초6 중등과정반",
          status: "수강",
        },
        error: null,
      };
    },
  };
}

test("class creation commits the class and its period memberships through one atomic RPC", async () => {
  const client = makeAtomicClassCreateClient();
  const service = createManagementService({
    supabase: client,
    probeRegistrationRuntime: async () => ({ mode: "legacy", version: 0 }),
  });

  const created = await service.createClass({
    id: CLASS_ID,
    name: "초6 중등과정반",
    classType: "정규",
    subject: "수학",
    grade: "초6",
    teacher: "강정은",
    schedule: "월수금 15:30-17:00",
    classroom: "별관 5강",
    capacity: 12,
    fee: 240000,
  }, {
    groupIds: GROUP_IDS,
  });

  assert.deepEqual(created, {
    id: CLASS_ID,
    name: "초6 중등과정반",
    status: "수강",
  });
  assert.deepEqual(client.calls, [["create_class_with_group_memberships_v1", {
    p_class: {
      id: CLASS_ID,
      name: "초6 중등과정반",
      class_type: "정규",
      subject: "수학",
      subject_area_key: null,
      grade: "초6",
      teacher: "강정은",
      schedule: "월수금 15:30-17:00",
      room: "별관 5강",
      capacity: 12,
      fee: 240000,
      status: "수강",
      textbook_ids: [],
    },
    p_group_ids: GROUP_IDS,
  }]]);
});

test("class creation rejects a missing period before any mutation can begin", async () => {
  const client = makeAtomicClassCreateClient();
  const service = createManagementService({
    supabase: client,
    probeRegistrationRuntime: async () => ({ mode: "legacy", version: 0 }),
  });

  await assert.rejects(
    () => service.createClass({ id: CLASS_ID, name: "초6 중등과정반" }),
    /기간을 하나 이상 선택하세요/,
  );
  assert.deepEqual(client.calls, []);
});

test("class period replacement is atomic so a failed insert cannot erase the existing period", async () => {
  const client = makeAtomicClassCreateClient();
  const service = createManagementService({ supabase: client });

  const result = await service.replaceClassGroupMemberships({
    classId: CLASS_ID,
    groupIds: GROUP_IDS,
  });

  assert.deepEqual(result, {
    id: CLASS_ID,
    name: "초6 중등과정반",
    status: "수강",
  });
  assert.deepEqual(client.calls, [["replace_class_group_memberships_v1", {
    p_class_id: CLASS_ID,
    p_group_ids: GROUP_IDS,
  }]]);
});
