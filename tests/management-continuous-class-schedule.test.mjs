import test from "node:test";
import assert from "node:assert/strict";

import {
  fromContinuousClassScheduleDefaults,
  formatClassScheduleSlots,
  parseClassScheduleSlots,
  toContinuousClassScheduleSlots,
} from "../src/features/management/class-schedule-slots.ts";
import {
  buildClassMetadataPayload,
  createManagementService,
} from "../src/features/management/management-service.js";

const CLASS_ID = "10000000-0000-4000-8000-000000000001";
const TEACHER_ID = "50000000-0000-4000-8000-000000000001";
const CLASSROOM_ID = "60000000-0000-4000-8000-000000000001";

test("normalized defaults preserve slot and catalog IDs through the five-column editor", () => {
  const slots = fromContinuousClassScheduleDefaults([
    {
      id: "20000000-0000-4000-8000-000000000001",
      weekday: 2,
      startTime: "18:00",
      endTime: "20:00",
      teacherCatalogId: TEACHER_ID,
      teacherName: "한지현",
      classroomCatalogId: CLASSROOM_ID,
      classroomName: "별관 5강",
      sortOrder: 3,
    },
  ]);

  assert.deepEqual(slots, [{
    id: "20000000-0000-4000-8000-000000000001",
    day: "화",
    startTime: "18:00",
    endTime: "20:00",
    teacher: "한지현",
    teacherCatalogId: TEACHER_ID,
    classroom: "별관 5강",
    classroomCatalogId: CLASSROOM_ID,
    sortOrder: 3,
  }]);
  assert.deepEqual(toContinuousClassScheduleSlots(slots), [{
    id: "20000000-0000-4000-8000-000000000001",
    weekday: 2,
    startTime: "18:00",
    endTime: "20:00",
    teacherCatalogId: TEACHER_ID,
    classroomCatalogId: CLASSROOM_ID,
    sortOrder: 3,
  }]);
});

test("normalized defaults retain full comma-containing catalog names", () => {
  const slots = fromContinuousClassScheduleDefaults([
    { id: "20000000-0000-4000-8000-000000000011", weekday: 1, startTime: "10:00", endTime: "11:00", teacherCatalogId: TEACHER_ID, teacherName: "김, 민", classroomCatalogId: CLASSROOM_ID, classroomName: "강의실 1", sortOrder: 0 },
    { id: "20000000-0000-4000-8000-000000000012", weekday: 2, startTime: "10:00", endTime: "11:00", teacherCatalogId: TEACHER_ID, teacherName: "교사 A", classroomCatalogId: CLASSROOM_ID, classroomName: "강의실 1, 별관", sortOrder: 1 },
    { id: "20000000-0000-4000-8000-000000000013", weekday: 3, startTime: "14:00", endTime: "15:30", teacherCatalogId: null, teacherName: "", classroomCatalogId: null, classroomName: "", sortOrder: 2 },
  ]);
  assert.deepEqual(slots.map(({ teacher, classroom }) => ({ teacher, classroom })), [
    { teacher: "김, 민", classroom: "강의실 1" },
    { teacher: "교사 A", classroom: "강의실 1, 별관" },
    { teacher: "", classroom: "" },
  ]);
  assert.deepEqual(toContinuousClassScheduleSlots(slots).map(({ teacherCatalogId, classroomCatalogId }) => ({ teacherCatalogId, classroomCatalogId })), [
    { teacherCatalogId: TEACHER_ID, classroomCatalogId: CLASSROOM_ID },
    { teacherCatalogId: TEACHER_ID, classroomCatalogId: CLASSROOM_ID },
    { teacherCatalogId: null, classroomCatalogId: null },
  ]);
});

test("legacy schedule consumer retains per-slot teacher and room after normalized save projection", () => {
  const slots = parseClassScheduleSlots(
    "월 09:00-10:00 (교사 A, 강의실 1)\n월 10:00-11:00 (교사 A, 강의실 1)\n수 14:00-15:30 (교사 B, 강의실 2)",
    "교사 A, 교사 B",
    "강의실 1(월), 강의실 1(월), 강의실 2(수)",
  );
  assert.deepEqual(slots.map(({ day, startTime, endTime, teacher, classroom }) => ({
    day, startTime, endTime, teacher, classroom,
  })), [
    { day: "월", startTime: "09:00", endTime: "10:00", teacher: "교사 A", classroom: "강의실 1" },
    { day: "월", startTime: "10:00", endTime: "11:00", teacher: "교사 A", classroom: "강의실 1" },
    { day: "수", startTime: "14:00", endTime: "15:30", teacher: "교사 B", classroom: "강의실 2" },
  ]);
});

test("projected mixed resource slots keep assigned and unassigned states in the legacy parser", () => {
  const slots = parseClassScheduleSlots(
    "월 09:00-10:00 (교사 A, 강의실 1)\n화 10:00-11:00 (교사 A, )\n수 14:00-15:30 (, 강의실 2)\n금 16:00-17:00 (, )",
    "교사 A",
    "강의실 1(월), 강의실 2(수)",
  );
  assert.deepEqual(slots.map(({ day, teacher, classroom }) => ({ day, teacher, classroom })), [
    { day: "월", teacher: "교사 A", classroom: "강의실 1" },
    { day: "화", teacher: "교사 A", classroom: "" },
    { day: "수", teacher: "", classroom: "강의실 2" },
    { day: "금", teacher: "", classroom: "" },
  ]);
  assert.deepEqual(formatClassScheduleSlots(slots), {
    schedule: "월 09:00-10:00 (교사 A, 강의실 1)\n화 10:00-11:00 (교사 A, )\n수 14:00-15:30 (, 강의실 2)\n금 16:00-17:00 (, )",
    teacher: "교사 A",
    classroom: "강의실 1(월), 강의실 2(수)",
  });
});

test("literal absence labels and former escape tokens remain assigned names", () => {
  const source = [
    { id: null, day: "월", startTime: "10:00", endTime: "11:00", teacher: "교사 미지정", teacherCatalogId: null, classroom: "강의실 미지정", classroomCatalogId: null, sortOrder: 0 },
    { id: null, day: "화", startTime: "10:00", endTime: "11:00", teacher: "~v1:41~", teacherCatalogId: null, classroom: "~41", classroomCatalogId: null, sortOrder: 1 },
    { id: null, day: "수", startTime: "14:00", endTime: "15:30", teacher: "", teacherCatalogId: null, classroom: "", classroomCatalogId: null, sortOrder: 2 },
  ];
  const projection = formatClassScheduleSlots(source);
  assert.equal(projection.schedule, [
    "월 10:00-11:00 (교사 미지정, 강의실 미지정)",
    "화 10:00-11:00 (~v1:41~, ~41)",
    "수 14:00-15:30 (, )",
  ].join("\n"));
  const slots = parseClassScheduleSlots(projection.schedule, projection.teacher, projection.classroom);
  assert.deepEqual(slots.map(({ day, teacher, classroom }) => ({ day, teacher, classroom })), source.map(({ day, teacher, classroom }) => ({ day, teacher, classroom })));
});

test("normalized metadata writes omit schedule-owned legacy columns", () => {
  assert.deepEqual(buildClassMetadataPayload({
    id: CLASS_ID,
    name: "고1 수학",
    subject: "수학",
    grade: "고1",
    teacher: "한지현",
    schedule: "화 18:00-20:00",
    classroom: "별관 5강",
  }), {
    id: CLASS_ID,
    name: "고1 수학",
    class_type: "정규",
    subject: "수학",
    subject_area_key: null,
    grade: "고1",
    capacity: 0,
    fee: 0,
    status: "수강",
    student_ids: [],
    waitlist_ids: [],
    textbook_ids: [],
  });
});

test("management service calls defaults, save, and initialization RPCs with revision and idempotency keys", async () => {
  const calls = [];
  const service = createManagementService({
    supabase: {
      async rpc(name, args) {
        calls.push([name, args]);
        return { data: { changed: true }, error: null };
      },
    },
  });
  const slots = [{
    id: "20000000-0000-4000-8000-000000000001",
    weekday: 2,
    startTime: "18:00",
    endTime: "20:00",
    teacherCatalogId: TEACHER_ID,
    classroomCatalogId: CLASSROOM_ID,
    sortOrder: 0,
  }];

  await service.getClassScheduleDefaults(CLASS_ID);
  await service.saveClassScheduleDefaults({
    classId: CLASS_ID,
    expectedScheduleRevision: 4,
    slots,
    requestKey: "70000000-0000-4000-8000-000000000001",
  });
  await service.initializeClassSchedule({
    classId: CLASS_ID,
    expectedScheduleRevision: 0,
    expectedSchedulePlanHash: "abc123",
    slots,
    requestKey: "70000000-0000-4000-8000-000000000002",
  });

  assert.deepEqual(calls, [
    ["get_class_schedule_defaults_v1", { p_class_id: CLASS_ID }],
    ["save_class_schedule_defaults_v1", {
      p_class_id: CLASS_ID,
      p_expected_schedule_revision: 4,
      p_slots: slots,
      p_request_key: "70000000-0000-4000-8000-000000000001",
      p_reason: null,
    }],
    ["initialize_new_class_schedule_v1", {
      p_class_id: CLASS_ID,
      p_expected_schedule_revision: 0,
      p_expected_schedule_plan_hash: "abc123",
      p_slots: slots,
      p_request_key: "70000000-0000-4000-8000-000000000002",
    }],
  ]);
});

test("a missing defaults RPC keeps legacy class creation available", async () => {
  const service = createManagementService({
    supabase: {
      async rpc() {
        return {
          data: null,
          error: { code: "PGRST202", message: "Could not find the function in the schema cache" },
        };
      },
    },
  });

  assert.equal(await service.getClassScheduleDefaults(CLASS_ID), null);
});

for (const change of [{ status: "개강 준비" }, { name: "일괄 이름 변경" }]) {
  test(`actual bulk merged-row save resolves each class mode before ${Object.keys(change)[0]} update`, async () => {
    const writes = []; const reads = [];
    const service = createManagementService({
      supabase: { async rpc(name, args) {
        if (name === "get_class_schedule_defaults_v1") {
          reads.push(args.p_class_id);
          return { data: { storageMode: args.p_class_id === CLASS_ID ? "normalized" : "legacy", authoritativeSource: "legacy" }, error: null };
        }
        assert.equal(name, "update_class_operational_v1");
        if (args.p_class_id === CLASS_ID && ["schedule", "teacher", "room"].some(key => key in args.p_patch)) {
          return { data: null, error: { code: "22023", message: "class_schedule_validation" } };
        }
        writes.push(args); return { data: { classRow: { id: args.p_class_id } }, error: null };
      } },
      probeRegistrationRuntime: async () => ({ mode: "ready" }),
      refreshPublicClassesCache: async () => ({ status: "complete" }),
    });
    // Same merged row payload supplied by management-page's bulk compact path.
    const row = { id: CLASS_ID, name: "고1 수학", subject: "수학", status: "수강", schedule: "화 18:00-20:00", teacher: "한지현", room: "별관 5강" };
    for (const id of [CLASS_ID, "10000000-0000-4000-8000-000000000002"]) {
      await service.updateClass({ ...row, id, ...change }, { resolveScheduleOwnership: true });
    }
    assert.equal(reads.length, 2);
    for (const key of ["schedule", "teacher", "room"]) assert.equal(key in writes[0].p_patch, false);
    assert.equal(writes[0].p_patch.status, change.status ?? "수강");
    assert.equal(writes[0].p_patch.name, change.name ?? row.name);
    assert.equal(writes[1].p_patch.schedule, row.schedule);
  });
}

test("bulk save fails closed if authoritative storage mode cannot be read", async () => {
  let writes = 0;
  const service = createManagementService({ supabase: { async rpc(name) {
    if (name === "get_class_schedule_defaults_v1") return { data: null, error: null };
    writes++; return { data: {}, error: null };
  } }, probeRegistrationRuntime: async () => ({ mode: "ready" }), refreshPublicClassesCache: async () => ({ status: "complete" }) });
  await assert.rejects(service.updateClass({ id: CLASS_ID, status: "수강" }, { resolveScheduleOwnership: true }), /수업 일정 저장 방식을 확인/);
  assert.equal(writes, 0);
});
