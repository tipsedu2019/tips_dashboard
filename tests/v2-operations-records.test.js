import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAcademicCalendarWorkspaceModel,
  buildClassScheduleRouteModel,
} from "../v2/src/features/operations/records.js";

test("buildAcademicCalendarWorkspaceModel groups events into month cells and upcoming agenda", () => {
  const model = buildAcademicCalendarWorkspaceModel({
    academicEvents: [
      {
        id: "event-1",
        title: "중앙고 1학기 중간고사",
        school_id: "school-1",
        type: "시험기간",
        start: "2026-04-21",
        end: "2026-04-25",
        grade: "고1",
      },
      {
        id: "event-2",
        title: "중앙고 체험학습",
        school_id: "school-1",
        type: "체험학습",
        start: "2026-04-09",
        end: "2026-04-09",
        grade: "고1",
      },
      {
        id: "event-3",
        title: "TIPS 설명회",
        type: "팁스",
        start: "2026-05-02",
        end: "2026-05-02",
        grade: "all",
      },
    ],
    academicSchools: [
      { id: "school-1", name: "중앙고", category: "high" },
    ],
    filters: {
      category: "high",
    },
    month: "2026-04",
  });

  assert.equal(model.summary.eventCount, 2);
  assert.equal(model.summary.schoolCount, 1);
  assert.equal(model.summary.upcomingCount, 2);
  assert.deepEqual(model.typeOptions, ["시험기간", "체험학습", "팁스"]);
  assert.equal(model.days.find((day) => day.date === "2026-04-09")?.events.length, 1);
  assert.equal(model.days.find((day) => day.date === "2026-04-21")?.events.length, 1);
  assert.equal(model.upcomingEvents[0].title, "중앙고 체험학습");
});

test("buildClassScheduleRouteModel summarizes warnings, sync groups, and filter options", () => {
  const model = buildClassScheduleRouteModel({
    classes: [
      {
        id: "class-1",
        name: "[영어] 중앙고1A",
        subject: "영어",
        grade: "고1",
        teacher: "한지현",
        schedule: "수금 19:30-21:30",
        term_id: "term-1",
        textbook_ids: ["tb-1"],
        schedule_plan: {
          sessions: [
            {
              id: "session-1",
              date: "2026-04-01",
              scheduleState: "active",
              sessionNumber: 1,
              textbookEntries: [
                {
                  textbookId: "tb-1",
                  actual: { status: "done", updatedAt: "2026-04-01T10:00:00.000Z" },
                },
              ],
            },
            {
              id: "session-2",
              date: "2026-04-03",
              scheduleState: "active",
              sessionNumber: 2,
              textbookEntries: [
                {
                  textbookId: "tb-1",
                  actual: { status: "pending", updatedAt: "" },
                },
              ],
            },
          ],
        },
      },
      {
        id: "class-2",
        name: "[영어] 중앙고1B",
        subject: "영어",
        grade: "고1",
        teacher: "김지현",
        schedule: "월 18:00-20:00",
        term_id: "term-1",
        textbook_ids: ["tb-2"],
        schedule_plan: {
          sessions: [
            {
              id: "session-3",
              date: "2026-04-01",
              scheduleState: "active",
              sessionNumber: 1,
              textbookEntries: [
                {
                  textbookId: "tb-2",
                  actual: { status: "done", updatedAt: "2026-04-01T09:00:00.000Z" },
                },
              ],
            },
          ],
        },
      },
    ],
    textbooks: [
      { id: "tb-1", title: "영어 개념서" },
      { id: "tb-2", title: "영어 실전" },
    ],
    progressLogs: [],
    classTerms: [{ id: "term-1", name: "26년 1학기" }],
    syncGroups: [
      { id: "group-1", name: "고1 영어", subject: "영어", color: "#3182f6" },
    ],
    syncGroupMembers: [
      { id: "member-1", group_id: "group-1", class_id: "class-1", sort_order: 0 },
      { id: "member-2", group_id: "group-1", class_id: "class-2", sort_order: 1 },
    ],
    filters: {
      subject: "영어",
    },
  });

  assert.equal(model.summary.classCount, 2);
  assert.equal(model.summary.warningCount, 1);
  assert.equal(model.summary.completedSessions, 2);
  assert.equal(model.summary.totalSessions, 3);
  assert.equal(model.filterOptions.subjects[0], "영어");
  assert.equal(model.syncGroupCards.length, 1);
  assert.equal(model.syncGroupCards[0].memberCount, 2);
  assert.match(model.rows[0].scheduleLabel, /수금 19:30-21:30|월 18:00-20:00/);
  assert.ok(model.rows.some((row) => row.warningText));
});

test("buildClassScheduleRouteModel keeps mixed textbook-entry completion at partial status", () => {
  const model = buildClassScheduleRouteModel({
    classes: [
      {
        id: "class-2",
        name: "[영어] 중앙고1B",
        subject: "영어",
        grade: "고1",
        teacher: "김지현",
        schedule: "월 18:00-20:00",
        term_id: "term-1",
        textbook_ids: ["tb-1", "tb-2"],
        schedule_plan: {
          sessions: [
            {
              id: "session-mixed",
              date: "2026-04-07",
              scheduleState: "active",
              sessionNumber: 3,
              textbookEntries: [
                {
                  textbookId: "tb-1",
                  actual: { status: "done", updatedAt: "2026-04-07T09:00:00.000Z" },
                },
                {
                  textbookId: "tb-2",
                  actual: { status: "pending", updatedAt: "" },
                },
              ],
            },
          ],
        },
      },
    ],
    textbooks: [
      { id: "tb-1", title: "영어 개념서" },
      { id: "tb-2", title: "영어 문제집" },
    ],
    progressLogs: [],
    classTerms: [{ id: "term-1", name: "26년 1학기" }],
    syncGroups: [],
    syncGroupMembers: [],
  });

  const session = model.rows[0].raw.sessions.find((item) => item.sessionNumber === 3);
  assert.ok(session);
  assert.equal(session.progressStatus, "partial");
});

test("buildClassScheduleRouteModel ignores pending session-level logs when textbook entries are already done", () => {
  const model = buildClassScheduleRouteModel({
    classes: [
      {
        id: "class-3",
        name: "[영어] 중앙고1C",
        subject: "영어",
        grade: "고1",
        teacher: "박지현",
        schedule: "금 18:00-20:00",
        term_id: "term-1",
        textbook_ids: ["tb-1"],
        schedule_plan: {
          sessions: [
            {
              id: "session-done",
              date: "2026-04-10",
              scheduleState: "active",
              sessionNumber: 4,
              textbookEntries: [
                {
                  textbookId: "tb-1",
                  actual: { status: "done", updatedAt: "2026-04-10T09:00:00.000Z" },
                },
              ],
            },
          ],
        },
      },
    ],
    textbooks: [{ id: "tb-1", title: "영어 개념서" }],
    progressLogs: [
      {
        id: "log-session-pending",
        class_id: "class-3",
        session_id: "session-done",
        session_order: 4,
        status: "pending",
        updated_at: "2026-04-10T10:00:00.000Z",
      },
    ],
    classTerms: [{ id: "term-1", name: "26년 1학기" }],
    syncGroups: [],
    syncGroupMembers: [],
  });

  const session = model.rows[0].raw.sessions.find((item) => item.sessionNumber === 4);
  assert.ok(session);
  assert.equal(session.progressStatus, "done");
});

test("buildClassScheduleRouteModel merges progress logs into session summaries and recent notes", () => {
  const model = buildClassScheduleRouteModel({
    classes: [
      {
        id: "class-1",
        name: "[영어] 중앙고1A",
        subject: "영어",
        grade: "고1",
        teacher: "한지현",
        schedule: "수금 19:30-21:30",
        term_id: "term-1",
        textbook_ids: ["tb-1"],
        schedule_plan: {
          sessions: [
            {
              id: "session-2",
              date: "2026-04-03",
              scheduleState: "active",
              sessionNumber: 2,
              textbookEntries: [
                {
                  textbookId: "tb-1",
                  plan: { label: "본문 2단원", memo: "핵심 어휘" },
                  actual: { status: "pending", updatedAt: "" },
                },
              ],
            },
            {
              id: "session-1",
              date: "2026-04-01",
              scheduleState: "active",
              sessionNumber: 1,
              textbookEntries: [
                {
                  textbookId: "tb-1",
                  actual: { status: "pending", updatedAt: "" },
                },
              ],
            },
          ],
        },
      },
    ],
    textbooks: [{ id: "tb-1", title: "영어 개념서" }],
    progressLogs: [
      {
        id: "log-1",
        class_id: "class-1",
        session_id: "session-2",
        session_order: 2,
        textbook_id: "tb-1",
        status: "done",
        range_label: "교재 2-3쪽",
        public_note: "본문 독해 완료",
        teacher_note: "어휘 복습 필요",
        content: "본문 독해와 어휘 확인",
        homework: "워크북 12쪽",
        updated_at: "2026-04-03T09:30:00.000Z",
      },
    ],
    classTerms: [{ id: "term-1", name: "26년 1학기" }],
    syncGroups: [],
    syncGroupMembers: [],
  });

  assert.equal(model.summary.classCount, 1);
  assert.equal(model.summary.completedSessions, 1);

  const row = model.rows[0];
  assert.equal(row.completedSessions, 1);
  assert.equal(row.latestActualSessionIndex, 2);
  assert.equal(row.nextActionSessionId, "session-1");

  const raw = row.raw;
  const session = raw.sessions.find((item) => item.sessionNumber === 2);
  assert.ok(session);
  assert.equal(session.progressStatus, "done");
  assert.equal(session.hasActualContent, true);
  assert.equal(session.updatedAt, "2026-04-03T09:30:00.000Z");
  assert.equal(session.rangeLabel, "교재 2-3쪽");
  assert.equal(session.publicNote, "본문 독해 완료");
  assert.equal(session.teacherNote, "어휘 복습 필요");
  assert.equal(session.content, "본문 독해와 어휘 확인");
  assert.equal(session.homework, "워크북 12쪽");
  assert.equal(session.textbookEntries[0]?.textbookId, "tb-1");
  assert.equal(session.textbookEntries[0]?.plan?.label, "본문 2단원");
  assert.equal(session.textbookEntries[0]?.plan?.memo, "핵심 어휘");
  assert.equal(session.textbookEntries[0]?.actual?.status, "done");
  assert.equal(session.textbookEntries[0]?.actual?.label, "교재 2-3쪽");
  assert.equal(session.textbookEntries[0]?.actual?.publicNote, "본문 독해 완료");
  assert.equal(session.textbookEntries[0]?.actual?.teacherNote, "어휘 복습 필요");
  assert.equal(
    session.noteSummary,
    "교재 2-3쪽 · 본문 독해 완료 · 어휘 복습 필요",
  );
  assert.equal(raw.latestNoteSessionLabel, "2회차");
  assert.equal(
    raw.latestNoteSummary,
    "교재 2-3쪽 · 본문 독해 완료 · 어휘 복습 필요",
  );
});

test("buildClassScheduleRouteModel preserves schedule adjustment fields from shared schedule-plan sessions", () => {
  const model = buildClassScheduleRouteModel({
    classes: [
      {
        id: "class-adjustment",
        name: "[영어] 일정 조정 점검반",
        subject: "영어",
        grade: "고2",
        teacher: "정하늘",
        schedule: "화목 19:00-21:00",
        term_id: "term-2",
        textbook_ids: ["tb-1"],
        schedule_plan: {
          session_list: [
            {
              session_id: "session-exception",
              session_number: 3,
              session_date: "2026-05-08",
              schedule_state: "exception",
              memo: "모의고사 휴강",
              makeup_date: "2026-05-10",
              textbook_entries: [
                {
                  textbook_id: "tb-1",
                  actual: { status: "pending", updatedAt: "" },
                },
              ],
            },
            {
              session_id: "session-makeup",
              session_number: 4,
              session_date: "2026-05-10",
              schedule_state: "makeup",
              memo: "주말 보강",
              original_date: "2026-05-08",
              textbook_entries: [
                {
                  textbook_id: "tb-1",
                  actual: { status: "pending", updatedAt: "" },
                },
              ],
            },
          ],
        },
      },
    ],
    textbooks: [{ id: "tb-1", title: "영어 개념서" }],
    progressLogs: [],
    classTerms: [{ id: "term-2", name: "26년 여름학기" }],
    syncGroups: [],
    syncGroupMembers: [],
  });

  const sessions = model.rows[0]?.raw?.sessions || [];
  const exceptionSession = sessions.find((item) => item.sessionNumber === 3);
  const makeupSession = sessions.find((item) => item.sessionNumber === 4);

  assert.ok(exceptionSession);
  assert.ok(makeupSession);
  assert.equal(exceptionSession.scheduleState, "exception");
  assert.equal(exceptionSession.memo, "모의고사 휴강");
  assert.equal(exceptionSession.makeupDate, "2026-05-10");
  assert.equal(exceptionSession.originalDate, "");
  assert.equal(makeupSession.scheduleState, "makeup");
  assert.equal(makeupSession.memo, "주말 보강");
  assert.equal(makeupSession.makeupDate, "");
  assert.equal(makeupSession.originalDate, "2026-05-08");
});

test("buildClassScheduleRouteModel preserves billing metadata from shared schedule-plan sessions", () => {
  const model = buildClassScheduleRouteModel({
    classes: [
      {
        id: "class-billing",
        name: "[영어] 청구구간 점검반",
        subject: "영어",
        grade: "고2",
        teacher: "정하늘",
        schedule: "화목 19:00-21:00",
        term_id: "term-2",
        textbook_ids: ["tb-1"],
        schedule_plan: {
          billing_periods: [
            {
              id: "period-2026-05",
              label: "5월 청구",
              color: "#7c3aed",
              start_date: "2026-05-01",
              end_date: "2026-05-31",
              session_count: 4,
            },
          ],
          session_list: [
            {
              session_id: "session-billing-1",
              session_number: 1,
              session_date: "2026-05-07",
              billing_id: "period-2026-05",
              billing_label: "5월 청구",
              billing_color: "#7c3aed",
              schedule_state: "active",
              textbook_entries: [
                {
                  textbook_id: "tb-1",
                  actual: { status: "pending", updatedAt: "" },
                },
              ],
            },
          ],
        },
      },
    ],
    textbooks: [{ id: "tb-1", title: "영어 개념서" }],
    progressLogs: [],
    classTerms: [{ id: "term-2", name: "26년 여름학기" }],
    syncGroups: [],
    syncGroupMembers: [],
  });

  const session = model.rows[0]?.raw?.sessions?.[0];
  assert.ok(session);
  assert.equal(session.id, "session-billing-1");
  assert.equal(session.date, "2026-05-07");
  assert.equal(session.billingId, "period-2026-05");
  assert.equal(session.billingLabel, "5월 청구");
  assert.equal(session.billingColor, "#7c3aed");
});
