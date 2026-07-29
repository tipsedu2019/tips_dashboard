import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContinuousScheduleBackfillPreview,
  compareContinuousScheduleShadow,
} from "../src/features/academic/continuous-class-schedule-model.ts";

const CLASS_ID = "10000000-0000-4000-8000-000000000001";

test("legacy sessions retain keys, states, and billing metadata without invented resources", () => {
  const preview = buildContinuousScheduleBackfillPreview({
    classId: CLASS_ID,
    scheduleText: "화 14:00-15:30",
    defaultSlots: [
      {
        day: "화",
        startTime: "14:00",
        endTime: "15:30",
        teacher: "양소윤",
        classroom: "별관 7강",
      },
    ],
    schedulePlan: {
      sessions: [
        {
          id: "session:001:2026-04-03",
          date: "2026-04-03",
          scheduleState: "active",
          billingId: "period-april",
          billingLabel: "4월",
          billingColor: "#3182f6",
        },
      ],
    },
  });

  assert.equal(preview.eligible, true);
  assert.deepEqual(preview.counts, { slots: 1, sessions: 1, issues: 0 });
  assert.deepEqual(preview.sessions[0], {
    classId: CLASS_ID,
    sessionKey: "session:001:2026-04-03",
    sessionDate: "2026-04-03",
    scheduleState: "active",
    startTime: null,
    endTime: null,
    teacherCatalogId: null,
    teacherNameSnapshot: "",
    classroomCatalogId: null,
    classroomNameSnapshot: "",
    memo: "",
    origin: "legacy",
    legacyBillingId: "period-april",
    legacyBillingLabel: "4월",
    legacyBillingColor: "#3182f6",
  });
});

test("invalid and duplicate legacy sessions become deterministic review issues", () => {
  const preview = buildContinuousScheduleBackfillPreview({
    classId: CLASS_ID,
    scheduleText: "화 14:00-15:30",
    defaultSlots: [
      {
        day: "화",
        startTime: "14:00",
        endTime: "15:30",
        teacher: "",
        classroom: "",
      },
    ],
    schedulePlan: {
      sessions: [
        { id: "same", date: "2026-04-03", state: "active" },
        { id: "same", date: "2026-04-10", state: "active" },
        { id: "", date: "", state: "unknown" },
      ],
    },
  });

  assert.equal(preview.eligible, false);
  assert.deepEqual(
    preview.issues.map((issue) => issue.code),
    [
      "duplicate_session_key",
      "missing_session_key",
      "missing_session_date",
      "invalid_session_state",
    ],
  );
});

test("shadow comparison reports exact key, date, state, and slot count mismatches", () => {
  const preview = buildContinuousScheduleBackfillPreview({
    classId: CLASS_ID,
    scheduleText: "화 14:00-15:30",
    defaultSlots: [
      {
        day: "화",
        startTime: "14:00",
        endTime: "15:30",
        teacher: "",
        classroom: "",
      },
    ],
    schedulePlan: {
      sessions: [{ id: "session-1", date: "2026-04-03", state: "active" }],
    },
  });
  const comparison = compareContinuousScheduleShadow(preview, {
    slots: [],
    sessions: [
      {
        session_key: "session-1",
        session_date: "2026-04-10",
        schedule_state: "makeup",
      },
    ],
  });

  assert.equal(comparison.matches, false);
  assert.deepEqual(comparison.issueCodes, [
    "slot_count_mismatch",
    "session_date_mismatch",
    "session_state_mismatch",
  ]);
});
