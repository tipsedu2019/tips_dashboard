import test from "node:test";
import assert from "node:assert/strict";

import {
  createManagementService,
  filterChangedTeacherCatalogPayload,
} from "../src/features/management/management-service.js";

function makeReadyRosterRpcClient() {
  const calls = { rpc: [], tables: [] };
  const rows = {
    students: [{
      id: "student-1",
      name: "김학생",
      class_ids: [],
      waitlist_class_ids: ["class-1"],
    }],
    classes: [{
      id: "class-1",
      name: "영어 A",
      student_ids: [],
      waitlist_ids: ["student-1"],
    }],
  };

  return {
    calls,
    from(table) {
      calls.tables.push(table);
      return {
        async select() {
          return { data: rows[table] || [], error: null };
        },
      };
    },
    async rpc(name, args) {
      calls.rpc.push([name, args]);
      const removed = args.p_next_mode === "removed";
      return {
        data: {
          studentId: "student-1",
          classId: "class-1",
          previousMode: "waitlist",
          nextMode: args.p_next_mode,
          changed: true,
          studentClassIds: removed ? [] : ["class-1"],
          studentWaitlistClassIds: [],
          classStudentIds: removed ? [] : ["student-1"],
          classWaitlistIds: [],
        },
        error: null,
      };
    },
  };
}

function makeStudentDeleteGuardClient({ student, classes = [], history = [], registrationEnrollments = [] }) {
  const calls = { deletes: [] };
  const rows = {
    students: student ? [student] : [],
    classes,
    student_class_enrollment_history: history,
    ops_registration_enrollments: registrationEnrollments,
  };
  return {
    calls,
    from(table) {
      return {
        async select() {
          return { data: rows[table] || [], error: null };
        },
        delete() {
          return {
            async in(column, ids) {
              calls.deletes.push([table, column, ids]);
              return { data: [], error: null };
            },
          };
        },
      };
    },
  };
}

test("ready management roster assignment returns only the committed atomic RPC projection", async () => {
  const client = makeReadyRosterRpcClient();
  const service = createManagementService({
    supabase: client,
    probeRegistrationRuntime: async () => ({ mode: "ready", version: 1 }),
  });

  const result = await service.assignStudentToClass({
    studentId: "student-1",
    classId: "class-1",
    mode: "enrolled",
  });

  assert.deepEqual(client.calls.rpc, [["set_student_class_roster_mode", {
    p_student_id: "student-1",
    p_class_id: "class-1",
    p_next_mode: "enrolled",
    p_expected_mode: "waitlist",
    p_memo: "management_roster",
  }]]);
  assert.deepEqual(result.student.class_ids, ["class-1"]);
  assert.deepEqual(result.student.waitlist_class_ids, []);
  assert.equal(result.student.status, "재원");
  assert.deepEqual(result.class.student_ids, ["student-1"]);
  assert.deepEqual(result.class.waitlist_ids, []);
  assert.deepEqual(client.calls.tables.sort(), ["classes", "students"]);
});

test("ready management roster rejects an incomplete or mismatched committed projection", async () => {
  const missingArraysClient = makeReadyRosterRpcClient();
  missingArraysClient.rpc = async () => ({
    data: {
      studentId: "student-1",
      classId: "class-1",
      previousMode: "waitlist",
      nextMode: "enrolled",
      changed: true,
    },
    error: null,
  });
  const missingArraysService = createManagementService({
    supabase: missingArraysClient,
    probeRegistrationRuntime: async () => ({ mode: "ready", version: 1 }),
  });
  await assert.rejects(
    missingArraysService.assignStudentToClass({ studentId: "student-1", classId: "class-1", mode: "enrolled" }),
    /명단 변경 결과를 다시 불러오세요/,
  );

  const mismatchedClient = makeReadyRosterRpcClient();
  const originalRpc = mismatchedClient.rpc.bind(mismatchedClient);
  mismatchedClient.rpc = async (name, args) => {
    const result = await originalRpc(name, args);
    return { ...result, data: { ...result.data, studentId: "student-other" } };
  };
  const mismatchedService = createManagementService({
    supabase: mismatchedClient,
    probeRegistrationRuntime: async () => ({ mode: "ready", version: 1 }),
  });
  await assert.rejects(
    mismatchedService.assignStudentToClass({ studentId: "student-1", classId: "class-1", mode: "enrolled" }),
    /명단 변경 결과를 다시 불러오세요/,
  );

  const wrongModeClient = makeReadyRosterRpcClient();
  const wrongModeRpc = wrongModeClient.rpc.bind(wrongModeClient);
  wrongModeClient.rpc = async (name, args) => {
    const result = await wrongModeRpc(name, args);
    return { ...result, data: { ...result.data, nextMode: "waitlist" } };
  };
  const wrongModeService = createManagementService({
    supabase: wrongModeClient,
    probeRegistrationRuntime: async () => ({ mode: "ready", version: 1 }),
  });
  await assert.rejects(
    wrongModeService.assignStudentToClass({ studentId: "student-1", classId: "class-1", mode: "enrolled" }),
    /명단 변경 결과를 다시 불러오세요/,
  );
});

test("maintenance management roster controls fail closed before any table or RPC write", async () => {
  const client = makeReadyRosterRpcClient();
  const service = createManagementService({
    supabase: client,
    probeRegistrationRuntime: async () => ({ mode: "maintenance", version: 0 }),
  });

  await assert.rejects(
    service.removeStudentFromClass({ studentId: "student-1", classId: "class-1" }),
    /데이터 전환 중/,
  );
  assert.deepEqual(client.calls.rpc, []);
  assert.deepEqual(client.calls.tables, []);
});

test("ready management roster removal returns the committed removed projection", async () => {
  const client = makeReadyRosterRpcClient();
  const service = createManagementService({
    supabase: client,
    probeRegistrationRuntime: async () => ({ mode: "ready", version: 1 }),
  });

  const result = await service.removeStudentFromClass({
    studentId: "student-1",
    classId: "class-1",
  });

  assert.deepEqual(client.calls.rpc, [["set_student_class_roster_mode", {
    p_student_id: "student-1",
    p_class_id: "class-1",
    p_next_mode: "removed",
    p_expected_mode: "waitlist",
    p_memo: "management_roster",
  }]]);
  assert.deepEqual(result.student.class_ids, []);
  assert.deepEqual(result.student.waitlist_class_ids, []);
  assert.deepEqual(result.class.student_ids, []);
  assert.deepEqual(result.class.waitlist_ids, []);
});

test("a missing ready management roster RPC invalidates readiness instead of falling back", async () => {
  const client = makeReadyRosterRpcClient();
  const missingRpc = { code: "PGRST202", message: "Could not find the function in the schema cache" };
  let invalidatedWith = null;
  client.rpc = async () => ({ data: null, error: missingRpc });
  const service = createManagementService({
    supabase: client,
    probeRegistrationRuntime: async () => ({ mode: "ready", version: 1 }),
    invalidateRegistrationRuntimeAfterReadyFailure(error) {
      invalidatedWith = error;
      throw new Error("runtime integrity failure");
    },
  });

  await assert.rejects(
    service.assignStudentToClass({ studentId: "student-1", classId: "class-1", mode: "enrolled" }),
    /runtime integrity failure/,
  );
  assert.equal(invalidatedWith, missingRpc);
});

test("ready student and class saves strip canonical roster fields and direct student status", async () => {
  const studentClient = makeStudentUpsertClient("__never_missing__");
  const studentService = createManagementService({
    supabase: studentClient,
    generateId: () => "student-1",
    probeRegistrationRuntime: async () => ({ mode: "ready", version: 1 }),
  });
  await studentService.updateStudent({
    id: "student-1",
    name: "김학생",
    status: "퇴원",
    classIds: ["class-1"],
    waitlistClassIds: ["class-2"],
  });
  assert.ok(!Object.prototype.hasOwnProperty.call(studentClient.calls[0], "status"));
  assert.ok(!Object.prototype.hasOwnProperty.call(studentClient.calls[0], "class_ids"));
  assert.ok(!Object.prototype.hasOwnProperty.call(studentClient.calls[0], "waitlist_class_ids"));

  const classClient = makeClassUpsertClient("__never_missing__");
  const classService = createManagementService({
    supabase: classClient,
    generateId: () => "class-1",
    probeRegistrationRuntime: async () => ({ mode: "ready", version: 1 }),
  });
  await classService.updateClass({
    id: "class-1",
    name: "영어 A",
    studentIds: ["student-1"],
    waitlistIds: ["student-2"],
  });
  assert.ok(!Object.prototype.hasOwnProperty.call(classClient.calls[0], "student_ids"));
  assert.ok(!Object.prototype.hasOwnProperty.call(classClient.calls[0], "waitlist_ids"));
});

test("student physical deletion checks reverse roster links and immutable history", async () => {
  const reverseLinkedClient = makeStudentDeleteGuardClient({
    student: { id: "student-1", class_ids: [], waitlist_class_ids: [] },
    classes: [{ id: "class-1", student_ids: ["student-1"], waitlist_ids: [] }],
  });
  await assert.rejects(
    createManagementService({ supabase: reverseLinkedClient }).deleteStudent("student-1"),
    /퇴원 처리하세요/,
  );
  assert.deepEqual(reverseLinkedClient.calls.deletes, []);

  const historyClient = makeStudentDeleteGuardClient({
    student: { id: "student-1", class_ids: [], waitlist_class_ids: [] },
    history: [{ student_id: "student-1", class_id: "class-old" }],
  });
  await assert.rejects(
    createManagementService({ supabase: historyClient }).deleteStudent("student-1"),
    /퇴원 처리하세요/,
  );
  assert.deepEqual(historyClient.calls.deletes, []);

  const registrationHistoryClient = makeStudentDeleteGuardClient({
    student: { id: "student-1", class_ids: [], waitlist_class_ids: [] },
    registrationEnrollments: [{ student_id: "student-1", class_id: "class-old", status: "canceled" }],
  });
  await assert.rejects(
    createManagementService({ supabase: registrationHistoryClient }).deleteStudent("student-1"),
    /퇴원 처리하세요/,
  );
  assert.deepEqual(registrationHistoryClient.calls.deletes, []);

  const mistakenRowClient = makeStudentDeleteGuardClient({
    student: { id: "student-1", class_ids: [], waitlist_class_ids: [] },
  });
  await createManagementService({ supabase: mistakenRowClient }).deleteStudent("student-1");
  assert.deepEqual(mistakenRowClient.calls.deletes, [["students", "id", ["student-1"]]]);
});

function makeStudentUpsertClient(errorColumn) {
  const calls = [];

  return {
    calls,
    from(table) {
      assert.equal(table, "students");
      return {
        upsert(payload) {
          calls.push(payload);
          return {
            async select() {
              if (Object.prototype.hasOwnProperty.call(payload, errorColumn)) {
                return {
                  data: null,
                  error: {
                    message: `Could not find the '${errorColumn}' column of 'students' in the schema cache`,
                  },
                };
              }

              return { data: [{ ...payload, saved: true }], error: null };
            },
          };
        },
      };
    },
  };
}

function makeClassUpsertClient(errorColumn) {
  const calls = [];

  return {
    calls,
    from(table) {
      assert.equal(table, "classes");
      return {
        upsert(payload) {
          calls.push(payload);
          return {
            async select() {
              if (Object.prototype.hasOwnProperty.call(payload, errorColumn)) {
                return {
                  data: null,
                  error: {
                    message: `Could not find the '${errorColumn}' column of 'classes' in the schema cache`,
                  },
                };
              }

              return { data: [{ ...payload, saved: true }], error: null };
            },
          };
        },
      };
    },
  };
}

function makeRelationClient(errorColumn) {
  const calls = {
    studentUpserts: [],
    classUpserts: [],
    historyInserts: [],
  };
  const fixtures = {
    students: [
      {
        id: "student-1",
        name: "김학생",
        status: "재원",
        class_ids: [],
        waitlist_class_ids: ["class-1"],
      },
    ],
    classes: [
      {
        id: "class-1",
        name: "고1 공통수학",
        class_type: "선행",
        subject: "수학",
        student_ids: [],
        waitlist_ids: ["student-1"],
      },
    ],
  };

  return {
    calls,
    from(table) {
      return {
        async select() {
          return { data: fixtures[table] || [], error: null };
        },
        upsert(payload) {
          if (table === "students") calls.studentUpserts.push(payload);
          if (table === "classes") calls.classUpserts.push(payload);
          return {
            async select() {
              if (table === "classes" && Object.prototype.hasOwnProperty.call(payload, errorColumn)) {
                return {
                  data: null,
                  error: {
                    message: `Could not find the '${errorColumn}' column of 'classes' in the schema cache`,
                  },
                };
              }

              return { data: [{ ...payload, saved: true }], error: null };
            },
          };
        },
        insert(payload) {
          calls.historyInserts.push(payload);
          return {
            async select() {
              return { data: payload, error: null };
            },
          };
        },
      };
    },
  };
}

function makeRelationPartialFailureClient() {
  const calls = {
    studentUpserts: [],
    classUpserts: [],
    historyInserts: [],
  };
  const fixtures = {
    students: [
      {
        id: "student-1",
        name: "김학생",
        status: "재원",
        class_ids: [],
        waitlist_class_ids: ["class-1"],
      },
    ],
    classes: [
      {
        id: "class-1",
        name: "고1 공통수학",
        class_type: "선행",
        subject: "수학",
        student_ids: [],
        waitlist_ids: ["student-1"],
      },
    ],
  };

  return {
    calls,
    from(table) {
      return {
        async select() {
          return { data: fixtures[table] || [], error: null };
        },
        upsert(payload) {
          if (table === "students") calls.studentUpserts.push(payload);
          if (table === "classes") calls.classUpserts.push(payload);
          return {
            async select() {
              if (table === "classes") {
                return { data: null, error: { message: "class write failed" } };
              }

              return { data: [{ ...payload, saved: true }], error: null };
            },
          };
        },
        insert(payload) {
          calls.historyInserts.push(payload);
          return {
            async select() {
              return { data: payload, error: null };
            },
          };
        },
      };
    },
  };
}

function makeTeacherCatalogAuditClient() {
  const calls = {
    teacherSelectIds: [],
    teacherUpserts: [],
    profileSelectIds: [],
    profileUpdates: [],
  };
  const fixtures = {
    teacher_catalogs: [
      {
        id: "teacher-1",
        name: "김선생",
        subjects: ["영어팀"],
        profile_id: "profile-1",
        account_email: "teacher@example.com",
        dashboard_role: "teacher",
        is_visible: false,
        sort_order: 1,
      },
    ],
    profiles: [
      {
        id: "profile-1",
        role: "teacher",
        teacher_catalog_id: "teacher-1",
      },
    ],
  };

  return {
    calls,
    from(table) {
      if (table === "teacher_catalogs") {
        return {
          select() {
            return {
              in(column, ids) {
                assert.equal(column, "id");
                calls.teacherSelectIds.push(ids);
                return Promise.resolve({
                  data: fixtures.teacher_catalogs.filter((row) => ids.includes(row.id)),
                  error: null,
                });
              },
            };
          },
          upsert(payload) {
            calls.teacherUpserts.push(payload);
            return {
              async select() {
                return { data: Array.isArray(payload) ? payload : [payload], error: null };
              },
            };
          },
        };
      }

      if (table === "profiles") {
        return {
          select() {
            return {
              in(column, ids) {
                assert.equal(column, "id");
                calls.profileSelectIds.push(ids);
                return Promise.resolve({
                  data: fixtures.profiles.filter((row) => ids.includes(row.id)),
                  error: null,
                });
              },
            };
          },
          update(patch) {
            return {
              eq(column, id) {
                assert.equal(column, "id");
                calls.profileUpdates.push({ id, patch });
                return {
                  async select() {
                    return { data: [{ id, ...patch }], error: null };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

test("teacher catalog saves ignore unchanged rows before audit-triggering upserts", () => {
  const payload = [
    {
      id: "teacher-1",
      name: "김선생",
      subjects: ["영어팀"],
      profile_id: "profile-1",
      account_email: "teacher@example.com",
      dashboard_role: "teacher",
      is_visible: true,
      sort_order: 1,
    },
    {
      id: "teacher-2",
      name: "박선생",
      subjects: ["수학팀"],
      profile_id: null,
      account_email: null,
      dashboard_role: "teacher",
      is_visible: true,
      sort_order: 2,
    },
  ];

  const changed = filterChangedTeacherCatalogPayload(payload, [
    {
      id: "teacher-1",
      name: "김선생",
      subjects: ["영어팀"],
      profile_id: "profile-1",
      account_email: "teacher@example.com",
      dashboard_role: "teacher",
      is_visible: true,
      sort_order: 1,
    },
  ]);

  assert.deepEqual(changed.map((row) => row.id), ["teacher-2"]);
});

test("teacher catalog saves do not update linked profiles when profile fields are unchanged", async () => {
  const client = makeTeacherCatalogAuditClient();
  const service = createManagementService({
    supabase: client,
    generateId: () => "teacher-1",
  });

  await service.upsertTeacherCatalogs([
    {
      id: "teacher-1",
      name: "김선생",
      subjects: ["영어팀"],
      profileId: "profile-1",
      accountEmail: "teacher@example.com",
      dashboardRole: "teacher",
      isVisible: true,
      sortOrder: 1,
    },
  ]);

  assert.equal(client.calls.teacherUpserts.length, 1);
  assert.equal(client.calls.teacherUpserts[0].length, 1);
  assert.equal(client.calls.teacherUpserts[0][0].id, "teacher-1");
  assert.deepEqual(client.calls.profileSelectIds, [["profile-1"]]);
  assert.deepEqual(client.calls.profileUpdates, []);
});

test("student upserts retry without optional counseling fields when the live schema is stale", async () => {
  const client = makeStudentUpsertClient("recent_issue");
  const service = createManagementService({
    supabase: client,
    generateId: () => "student-1",
  });

  const saved = await service.updateStudent({
    id: "student-1",
    name: "김학생",
    recentIssue: "학부모 전화 요청",
    status: "재원",
  });

  assert.equal(saved.saved, true);
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[0].recent_issue, "학부모 전화 요청");
  assert.ok(!Object.prototype.hasOwnProperty.call(client.calls[1], "recent_issue"));
  assert.equal(client.calls[1].name, "김학생");
});

test("class upserts retry without the class type field when the live schema is stale", async () => {
  const client = makeClassUpsertClient("class_type");
  const service = createManagementService({
    supabase: client,
    generateId: () => "class-1",
  });

  const saved = await service.updateClass({
    id: "class-1",
    name: "고1 공통수학",
    classType: "선행",
    subject: "수학",
  });

  assert.equal(saved.saved, true);
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[0].class_type, "선행");
  assert.ok(!Object.prototype.hasOwnProperty.call(client.calls[1], "class_type"));
  assert.equal(client.calls[1].name, "고1 공통수학");
});

test("student class relation changes use the same stale schema fallback for class writes", async () => {
  const client = makeRelationClient("class_type");
  const service = createManagementService({
    supabase: client,
    generateId: () => "generated",
  });

  await service.assignStudentToClass({
    studentId: "student-1",
    classId: "class-1",
    mode: "enrolled",
  });

  assert.equal(client.calls.studentUpserts.length, 1);
  assert.equal(client.calls.classUpserts.length, 2);
  assert.equal(client.calls.classUpserts[0].class_type, "선행");
  assert.ok(!Object.prototype.hasOwnProperty.call(client.calls.classUpserts[1], "class_type"));
  assert.deepEqual(client.calls.classUpserts[1].student_ids, ["student-1"]);
  assert.deepEqual(client.calls.classUpserts[1].waitlist_ids, []);
  assert.equal(client.calls.historyInserts.length, 1);
});

test("student class relation changes roll back the student side if the class write fails", async () => {
  const client = makeRelationPartialFailureClient();
  const service = createManagementService({
    supabase: client,
    generateId: () => "generated",
  });

  await assert.rejects(
    () =>
      service.assignStudentToClass({
        studentId: "student-1",
        classId: "class-1",
        mode: "enrolled",
      }),
    (error) => error?.message === "class write failed",
  );

  assert.equal(client.calls.classUpserts.length, 1);
  assert.equal(client.calls.studentUpserts.length, 2);
  assert.deepEqual(client.calls.studentUpserts[0].class_ids, ["class-1"]);
  assert.deepEqual(client.calls.studentUpserts[0].waitlist_class_ids, []);
  assert.deepEqual(client.calls.studentUpserts[1].class_ids, []);
  assert.deepEqual(client.calls.studentUpserts[1].waitlist_class_ids, ["class-1"]);
  assert.equal(client.calls.historyInserts.length, 0);
});
