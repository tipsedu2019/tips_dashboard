import test from "node:test";
import assert from "node:assert/strict";

import {
  createManagementService,
  filterChangedTeacherCatalogPayload,
} from "../src/features/management/management-service.js";

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
