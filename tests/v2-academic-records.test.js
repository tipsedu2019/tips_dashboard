import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCurriculumWorkspaceModel,
  buildTimetableGridPanels,
  buildTimetableWorkspaceModel,
} from "../v2/src/features/academic/records.js";

test("buildTimetableWorkspaceModel creates live timetable rows and filter options", () => {
  const model = buildTimetableWorkspaceModel({
    classes: [
      {
        id: "class-1",
        name: "[영어] 중앙고A",
        subject: "영어",
        grade: "고1",
        teacher: "한지현",
        room: "본관 6강",
        schedule: "금 19:30-21:30",
        period: "2026 1학기",
        status: "수업 진행 중",
      },
      {
        id: "class-2",
        name: "[수학] 중2 B",
        subject: "수학",
        grade: "중2",
        teacher: "김민수",
        room: "본관 2강",
        schedule: "화수 17:00-18:30",
        period: "2026 1학기",
        status: "개강 준비 중",
      },
    ],
  });

  assert.ok(model.dayOptions.includes("화"));
  assert.ok(model.dayOptions.includes("금"));
  assert.ok(model.subjectOptions.includes("영어"));
  assert.ok(model.subjectOptions.includes("수학"));
  assert.equal(model.rows.length, 3);
  assert.equal(model.rows[0].title, "중2 B");
  assert.equal(model.rows.find((row) => row.title === "중앙고A")?.teacher, "한지현");
  assert.equal(model.rows.find((row) => row.title === "중앙고A")?.classroom, "본관 6강");
  assert.equal(model.summary.classCount, 2);
  assert.equal(model.summary.slotCount, 3);
  assert.equal(model.summary.weeklyMinutes, 300);
});

test("buildTimetableGridPanels creates compare panels for teacher weekly grid view", () => {
  const workspace = buildTimetableWorkspaceModel({
    classes: [
      {
        id: "class-1",
        name: "[영어] 중앙고1A",
        subject: "영어",
        grade: "고1",
        teacher: "강부희",
        room: "본관 4강",
        schedule: "월 17:00-18:30",
        period: "2026 1학기",
        status: "수업 진행 중",
      },
      {
        id: "class-2",
        name: "[영어] 대기고1A",
        subject: "영어",
        grade: "고1",
        teacher: "김민경",
        room: "본관 6강",
        schedule: "화 19:00-20:30",
        period: "2026 1학기",
        status: "수업 진행 중",
      },
    ],
    filters: {
      subject: "영어",
    },
  });

  const grid = buildTimetableGridPanels({
    workspace,
    view: "teacher-weekly",
    gridCount: 2,
    selectedTargets: [],
  });

  assert.equal(grid.axisMode, "teacher");
  assert.equal(grid.panels.length, 2);
  assert.equal(grid.panels[0].columns.length, 7);
  assert.equal(grid.panels[0].blocks.length, 1);
  assert.equal(grid.panels[0].blocks[0].columnIndex, 0);
  assert.equal(grid.panels[1].blocks[0].columnIndex, 1);
  assert.equal(grid.panels[0].blocks[0].title, "중앙고1A");
});

test("buildCurriculumWorkspaceModel summarizes plan sessions and progress log fallback", () => {
  const model = buildCurriculumWorkspaceModel({
    classes: [
      {
        id: "class-1",
        name: "[영어] 중앙고A",
        subject: "영어",
        grade: "고1",
        teacher: "한지현",
        room: "본관 6강",
        schedule: "금 19:30-21:30",
        period: "2026 1학기",
        textbook_ids: ["tb-1", "tb-2"],
        schedule_plan: {
          sessions: [
            {
              id: "session-1",
              scheduleState: "active",
              progressStatus: "done",
              textbookEntries: [
                { actual: { status: "done", updatedAt: "2026-04-01T10:00:00.000Z" } },
              ],
            },
            {
              id: "session-2",
              scheduleState: "active",
              progressStatus: "partial",
              textbookEntries: [
                { actual: { status: "partial", updatedAt: "2026-04-03T10:00:00.000Z" } },
              ],
            },
            {
              id: "session-3",
              scheduleState: "tbd",
              progressStatus: "pending",
              textbookEntries: [],
            },
            {
              id: "session-4",
              scheduleState: "active",
              progressStatus: "pending",
              textbookEntries: [{ actual: { status: "pending", updatedAt: "" } }],
            },
          ],
        },
      },
      {
        id: "class-2",
        name: "[수학] 중2 B",
        subject: "수학",
        grade: "중2",
        teacher: "김민수",
        room: "본관 2강",
        schedule: "화 17:00-18:30",
        period: "2026 1학기",
        textbook_ids: ["tb-3"],
      },
    ],
    textbooks: [
      { id: "tb-1", title: "영어 개념서" },
      { id: "tb-2", title: "영어 문제집" },
      { id: "tb-3", title: "수학 실전" },
    ],
    progressLogs: [
      {
        id: "log-1",
        class_id: "class-2",
        session_id: "session-a",
        status: "done",
        updated_at: "2026-03-28T09:00:00.000Z",
      },
    ],
  });

  const englishRow = model.rows.find((row) => row.id === "class-1");
  const mathRow = model.rows.find((row) => row.id === "class-2");

  assert.ok(englishRow);
  assert.equal(englishRow.totalSessions, 3);
  assert.equal(englishRow.completedSessions, 1);
  assert.equal(englishRow.updatedSessions, 2);
  assert.equal(englishRow.delayedSessions, 1);
  assert.equal(englishRow.textbookCount, 2);
  assert.equal(englishRow.lastUpdatedAt, "2026-04-03T10:00:00.000Z");

  assert.ok(mathRow);
  assert.equal(mathRow.totalSessions, 1);
  assert.equal(mathRow.completedSessions, 1);
  assert.equal(mathRow.updatedSessions, 1);
  assert.equal(mathRow.delayedSessions, 0);

  assert.equal(model.summary.classCount, 2);
  assert.equal(model.summary.managedClassCount, 2);
  assert.equal(model.summary.totalSessions, 4);
  assert.equal(model.summary.completedSessions, 2);
  assert.equal(model.summary.pendingSessions, 1);
});

test("buildCurriculumWorkspaceModel merges progress logs into session detail and pending queues", () => {
  const model = buildCurriculumWorkspaceModel({
    classes: [
      {
        id: "class-1",
        name: "[영어] 중앙고A",
        subject: "영어",
        grade: "고1",
        teacher: "한지현",
        room: "본관 6강",
        schedule: "금 19:30-21:30",
        period: "2026 1학기",
        textbook_ids: ["tb-1"],
        schedule_plan: {
          sessions: [
            {
              id: "session-1",
              sessionNumber: 1,
              scheduleState: "active",
              textbookEntries: [{ actual: { status: "pending", updatedAt: "" } }],
            },
            {
              id: "session-2",
              sessionNumber: 2,
              scheduleState: "active",
              textbookEntries: [{ actual: { status: "pending", updatedAt: "" } }],
            },
            {
              id: "session-3",
              sessionNumber: 3,
              scheduleState: "active",
              textbookEntries: [{ actual: { status: "pending", updatedAt: "" } }],
            },
          ],
        },
      },
      {
        id: "class-2",
        name: "[수학] 중2 B",
        subject: "수학",
        grade: "중2",
        teacher: "김민수",
        room: "본관 2강",
        schedule: "화 17:00-18:30",
        period: "2026 1학기",
        textbook_ids: ["tb-3"],
      },
    ],
    textbooks: [
      { id: "tb-1", title: "영어 개념서" },
      { id: "tb-3", title: "수학 실전" },
    ],
    progressLogs: [
      {
        id: "log-1",
        class_id: "class-1",
        session_id: "session-2",
        session_order: 2,
        status: "done",
        range_label: "교재 2-3쪽",
        public_note: "본문 독해 완료",
        teacher_note: "어휘 복습 필요",
        updated_at: "2026-04-03T09:30:00.000Z",
      },
      {
        id: "log-2",
        class_id: "class-2",
        session_id: "session-a",
        session_order: 1,
        status: "partial",
        range_label: "1단원 예제",
        public_note: "유형 설명 진행",
        teacher_note: "숙제 확인 예정",
        updated_at: "2026-03-28T09:00:00.000Z",
      },
    ],
  });

  const englishRow = model.rows.find((row) => row.id === "class-1");
  const mathRow = model.rows.find((row) => row.id === "class-2");

  assert.ok(englishRow);
  assert.equal(englishRow.totalSessions, 3);
  assert.equal(englishRow.completedSessions, 1);
  assert.equal(englishRow.updatedSessions, 1);
  assert.equal(englishRow.delayedSessions, 2);
  assert.equal(englishRow.latestNoteSessionLabel, "2회차");
  assert.equal(
    englishRow.latestNoteSummary,
    "교재 2-3쪽 · 본문 독해 완료 · 어휘 복습 필요",
  );
  assert.deepEqual(englishRow.pendingSessionLabels, ["1회차", "3회차"]);
  assert.equal(englishRow.sessionSummaries.length, 3);
  assert.deepEqual(
    englishRow.sessionSummaries.map((session) => session.progressStatus),
    ["pending", "done", "pending"],
  );

  const completedSession = englishRow.sessionSummaries.find(
    (session) => session.sessionNumber === 2,
  );
  assert.ok(completedSession);
  assert.equal(completedSession.hasActualContent, true);
  assert.equal(completedSession.updatedAt, "2026-04-03T09:30:00.000Z");
  assert.equal(
    completedSession.noteSummary,
    "교재 2-3쪽 · 본문 독해 완료 · 어휘 복습 필요",
  );

  assert.ok(mathRow);
  assert.equal(mathRow.totalSessions, 1);
  assert.equal(mathRow.completedSessions, 0);
  assert.equal(mathRow.updatedSessions, 1);
  assert.equal(mathRow.delayedSessions, 0);
  assert.equal(mathRow.latestNoteSessionLabel, "1회차");
  assert.equal(mathRow.pendingSessionLabels.length, 0);
  assert.equal(mathRow.sessionSummaries[0].progressStatus, "partial");
  assert.equal(
    mathRow.sessionSummaries[0].noteSummary,
    "1단원 예제 · 유형 설명 진행 · 숙제 확인 예정",
  );
});

test("master sort order flows into timetable teacher/classroom options", () => {
  const model = buildTimetableWorkspaceModel({
    classes: [
      {
        id: "class-1",
        name: "[영어] A반",
        subject: "영어",
        grade: "고1",
        teacher: "김민수",
        room: "본관 2강",
        schedule: "월 17:00-18:30",
        period: "2026 1학기",
        status: "수업 진행 중",
      },
      {
        id: "class-2",
        name: "[영어] B반",
        subject: "영어",
        grade: "고1",
        teacher: "한지현",
        room: "별관 3강",
        schedule: "화 19:00-20:30",
        period: "2026 1학기",
        status: "수업 진행 중",
      },
    ],
    teacherCatalogs: [
      { id: "t-1", name: "한지현", subjects: ["영어"], is_visible: true, sort_order: 2 },
      { id: "t-2", name: "김민수", subjects: ["영어"], is_visible: true, sort_order: 1 },
    ],
    classroomCatalogs: [
      { id: "c-1", name: "별관 3강", subjects: ["영어"], is_visible: true, sort_order: 2 },
      { id: "c-2", name: "본관 2강", subjects: ["영어"], is_visible: true, sort_order: 1 },
    ],
    filters: {
      subject: "영어",
    },
  });

  assert.deepEqual(model.teacherOptions, ["김민수", "한지현"]);
  assert.deepEqual(model.classroomOptions, ["본관 2강", "별관 3강"]);
});

test("master sort order flows into curriculum teacher and term filters", () => {
  const model = buildCurriculumWorkspaceModel({
    classes: [
      {
        id: "class-1",
        name: "[영어] A반",
        subject: "영어",
        grade: "고1",
        teacher: "김민수",
        room: "본관 2강",
        schedule: "월 17:00-18:30",
        term_id: "term-2",
        status: "수업 진행 중",
      },
      {
        id: "class-2",
        name: "[영어] B반",
        subject: "영어",
        grade: "고1",
        teacher: "한지현",
        room: "별관 3강",
        schedule: "화 19:00-20:30",
        term_id: "term-1",
        status: "수업 진행 중",
      },
    ],
    classTerms: [
      { id: "term-1", name: "2026 1학기", sort_order: 2 },
      { id: "term-2", name: "2026 여름특강", sort_order: 1 },
    ],
    teacherCatalogs: [
      { id: "t-1", name: "한지현", subjects: ["영어"], is_visible: true, sort_order: 2 },
      { id: "t-2", name: "김민수", subjects: ["영어"], is_visible: true, sort_order: 1 },
    ],
  });

  assert.deepEqual(model.termOptions, ["2026 여름특강", "2026 1학기"]);
  assert.deepEqual(model.teacherOptions, ["김민수", "한지현"]);
});
