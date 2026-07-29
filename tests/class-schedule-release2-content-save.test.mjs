import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildLessonContentPatch, buildSchedulePlanForSave } from "../src/lib/class-schedule-planner.js";

test("content patch retains only textbook content and stable session keys", () => {
  assert.deepEqual(buildLessonContentPatch({
    selectedDays: [1, 3],
    billingPeriods: [{ id: "period-1", startDate: "2026-08-01" }],
    textbooks: [{ textbookId: "book-1", order: 0, role: "main" }],
    sessions: [{
      id: "session-row-id",
      sessionKey: "default:slot-1:2026-08-03",
      date: "2026-08-03",
      scheduleState: "makeup",
      startTime: "18:00",
      teacherCatalogId: "teacher-1",
      textbookEntries: [{ textbookId: "book-1", planStart: "1", planEnd: "2" }],
    }],
  }), {
    textbooks: [{ textbookId: "book-1", order: 0, role: "main" }],
    sessions: [{
      sessionKey: "default:slot-1:2026-08-03",
      textbookEntries: [{ textbookId: "book-1", planStart: "1", planEnd: "2" }],
    }],
  });
});

test("content patch includes only session keys returned by the bounded normalized read", () => {
  const patch = buildLessonContentPatch({
    textbooks: [],
    sessions: [
      { sessionKey: "known", textbookEntries: [{ textbookId: "book-1" }] },
      { sessionKey: "generated-locally", textbookEntries: [{ textbookId: "book-2" }] },
    ],
  }, { sessionKeys: ["known"] });

  assert.deepEqual(patch.sessions, [{
    sessionKey: "known",
    textbookEntries: [{ textbookId: "book-1" }],
  }]);
});

test("planner save output preserves a normalized stable session key", () => {
  const saved = buildSchedulePlanForSave({
    selectedDays: [1],
    billingPeriods: [{ id: "period-1", month: "2026-08", startDate: "2026-08-01", endDate: "2026-08-31", totalSessions: 4 }],
    sessions: [{
      id: "session-row-id",
      sessionKey: "default:slot-1:2026-08-03",
      date: "2026-08-03",
      textbookEntries: [],
    }],
  }, { subject: "영어" });

  assert.equal(saved.sessions[0].sessionKey, "default:slot-1:2026-08-03");
});

test("content mutation validates the restricted patch and preserves current session snapshots", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260728233510_continuous_class_schedule_release2_mutations.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /p_content_patch - 'textbooks' - 'sessions'/);
  assert.match(migration, /v_patch_session - 'sessionKey' - 'textbookEntries'/);
  assert.match(migration, /current_session \|\| coalesce/);
  assert.match(migration, /continuous_class_schedule_content_hash_v1/);
  assert.match(migration, /'contentHash', dashboard_private\.continuous_class_schedule_content_hash_v1/);
});
