import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNormalizedLessonSessionSaveInput,
  mergeNormalizedLessonSessions,
} from "../src/features/operations/records.js";

test("normalized session merge replaces schedule fields without removing legacy textbook content", () => {
  const result = mergeNormalizedLessonSessions({
    sessions: [{ id: "legacy-1", date: "2026-08-04", scheduleState: "active", textbookEntries: [{ textbookId: "book-1", unit: "1과" }] }],
    note: "keep",
  }, [{
    id: "session-1", session_key: "legacy-1", session_date: "2026-08-04", schedule_state: "makeup",
    revision: 7, start_time: "18:00:00", end_time: "20:00:00",
    teacher_catalog_id: "teacher-1", teacher_name_snapshot: "한지현",
    classroom_catalog_id: "room-1", classroom_name_snapshot: "별관 5강",
    memo: "시간 변경", public_note: "학부모 확인", teacher_note: "출석 유의",
  }]);

  assert.deepEqual(result, {
    note: "keep",
    sessions: [{
      id: "session-1", sessionKey: "legacy-1", date: "2026-08-04", scheduleState: "makeup",
      revision: 7, startTime: "18:00", endTime: "20:00",
      teacherCatalogId: "teacher-1", teacherNameSnapshot: "한지현",
      classroomCatalogId: "room-1", classroomNameSnapshot: "별관 5강",
      memo: "시간 변경", publicNote: "학부모 확인", teacherNote: "출석 유의",
      textbookEntries: [{ textbookId: "book-1", unit: "1과" }],
    }],
  });
});

test("normalized session save input keeps revision and sends blank optional values as null", () => {
  assert.deepEqual(buildNormalizedLessonSessionSaveInput({
    id: "session-1",
    revision: 7,
    scheduleState: "exception",
    date: "2026-08-04",
    startTime: "",
    endTime: "",
    teacherCatalogId: "",
    classroomCatalogId: "room-1",
    memo: "휴강",
    publicNote: "학부모 확인",
    teacherNote: "전화 완료",
  }), {
    sessionId: "session-1",
    expectedRevision: 7,
    scheduleState: "exception",
    sessionDate: "2026-08-04",
    startTime: null,
    endTime: null,
    teacherCatalogId: null,
    classroomCatalogId: "room-1",
    memo: "휴강",
    publicNote: "학부모 확인",
    teacherNote: "전화 완료",
    correctionReason: null,
  });
});
