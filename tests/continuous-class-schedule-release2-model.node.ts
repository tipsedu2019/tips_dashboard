import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContinuousLessonSessionGenerationCandidates,
  diffContinuousScheduleSlots,
  compareContinuousScheduleShadow,
} from "../src/features/academic/continuous-class-schedule-model.ts";

const CLASS_ID = "10000000-0000-4000-8000-000000000001";
const SLOT_ID = "40000000-0000-4000-8000-000000000001";

test("slot diff preserves owned IDs and rejects duplicate schedule times", () => {
  const result = diffContinuousScheduleSlots({
    classId: CLASS_ID,
    existingSlots: [{
      id: SLOT_ID,
      classId: CLASS_ID,
      weekday: 2,
      startTime: "14:00",
      endTime: "15:30",
      teacherCatalogId: null,
      classroomCatalogId: null,
      sortOrder: 0,
    }],
    slots: [
      {
        id: SLOT_ID,
        weekday: 2,
        startTime: "14:30",
        endTime: "15:30",
        teacherCatalogId: null,
        classroomCatalogId: null,
        sortOrder: 0,
      },
      {
        id: null,
        weekday: 2,
        startTime: "14:30",
        endTime: "15:30",
        teacherCatalogId: null,
        classroomCatalogId: null,
        sortOrder: 1,
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [
    { code: "duplicate_slot_time", index: 0 },
    { code: "duplicate_slot_time", index: 1 },
  ]);
  assert.deepEqual(result.diff, { inserts: [], updates: [], deletes: [] });
});

test("generation candidates snapshot default values and never replace an existing key", () => {
  const result = buildContinuousLessonSessionGenerationCandidates({
    classId: CLASS_ID,
    dateFrom: "2026-04-06",
    dateTo: "2026-04-13",
    slots: [{
      id: SLOT_ID,
      weekday: 1,
      startTime: "14:00",
      endTime: "15:30",
      teacherCatalogId: "50000000-0000-4000-8000-000000000001",
      teacherName: "테스트 선생님",
      classroomCatalogId: "60000000-0000-4000-8000-000000000001",
      classroomName: "테스트 강의실",
      sortOrder: 0,
    }],
    existingSessionKeys: new Set([`default:${SLOT_ID}:2026-04-06`]),
  });

  assert.deepEqual(result.counts, { requested: 2, creatable: 1, existing: 1, excluded: 0 });
  assert.deepEqual(result.candidates, [
    {
      sessionKey: `default:${SLOT_ID}:2026-04-06`,
      sessionDate: "2026-04-06",
      sourceScheduleSlotId: SLOT_ID,
      status: "existing",
      snapshot: null,
    },
    {
      sessionKey: `default:${SLOT_ID}:2026-04-13`,
      sessionDate: "2026-04-13",
      sourceScheduleSlotId: SLOT_ID,
      status: "creatable",
      snapshot: {
        startTime: "14:00",
        endTime: "15:30",
        teacherCatalogId: "50000000-0000-4000-8000-000000000001",
        teacherNameSnapshot: "테스트 선생님",
        classroomCatalogId: "60000000-0000-4000-8000-000000000001",
        classroomNameSnapshot: "테스트 강의실",
        legacyBillingId: "period:2026-04",
        legacyBillingLabel: "2026년 4월",
        legacyBillingColor: "#3182f6",
      },
    },
  ]);
});

test("shadow comparison reports snapshot and projection mismatches without inventing legacy resources", () => {
  const comparison = compareContinuousScheduleShadow({
    classId: CLASS_ID,
    eligible: true,
    slots: [],
    projectionHash: "expected",
    sessions: [{
      classId: CLASS_ID,
      sessionKey: "legacy-1",
      sessionDate: "2026-04-03",
      scheduleState: "active",
      startTime: null,
      endTime: null,
      teacherCatalogId: null,
      teacherNameSnapshot: "",
      classroomCatalogId: null,
      classroomNameSnapshot: "",
      memo: "기존 메모",
      origin: "legacy",
      legacyBillingId: "",
      legacyBillingLabel: "",
      legacyBillingColor: "",
    }],
    issues: [],
    counts: { slots: 0, sessions: 1, issues: 0 },
  }, {
    slots: [],
    projectionHash: "unexpected",
    sessions: [{
      session_key: "legacy-1",
      session_date: "2026-04-03",
      schedule_state: "active",
      start_time: "14:00:00",
      end_time: "15:30:00",
      teacher_catalog_id: "50000000-0000-4000-8000-000000000001",
      teacher_name_snapshot: "추정 선생님",
      classroom_catalog_id: "60000000-0000-4000-8000-000000000001",
      classroom_name_snapshot: "추정 강의실",
      memo: "다른 메모",
    }],
  });

  assert.equal(comparison.matches, false);
  assert.deepEqual(comparison.issueCodes, [
    "session_time_mismatch",
    "session_teacher_mismatch",
    "session_classroom_mismatch",
    "session_memo_mismatch",
    "projection_mismatch",
  ]);
});
