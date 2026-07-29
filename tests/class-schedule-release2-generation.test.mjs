import test from "node:test";
import assert from "node:assert/strict";

import { mergeNormalizedLessonSessions } from "../src/features/operations/records.js";

test("normalized session merge replaces schedule fields without removing legacy textbook content", () => {
  const result = mergeNormalizedLessonSessions({
    sessions: [{ id: "legacy-1", date: "2026-08-04", scheduleState: "active", textbookEntries: [{ textbookId: "book-1", unit: "1과" }] }],
    note: "keep",
  }, [{
    id: "session-1", session_key: "legacy-1", session_date: "2026-08-04", schedule_state: "makeup",
    start_time: "18:00:00", end_time: "20:00:00", teacher_name_snapshot: "한지현", classroom_name_snapshot: "별관 5강",
  }]);

  assert.deepEqual(result, {
    note: "keep",
    sessions: [{
      id: "session-1", sessionKey: "legacy-1", date: "2026-08-04", scheduleState: "makeup",
      startTime: "18:00", endTime: "20:00", teacherNameSnapshot: "한지현", classroomNameSnapshot: "별관 5강",
      textbookEntries: [{ textbookId: "book-1", unit: "1과" }],
    }],
  });
});
