import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CLASS_SCHEDULE_VIEW_STATE,
  buildSessionProgressLogPayloads,
  buildClassScheduleWorkspaceData,
  buildSessionProgressKey,
  createMergedClassScheduleModel,
  restoreClassScheduleViewState,
} from "../src/lib/classScheduleWorkspaceModel.js";
import { buildCalendarData } from "../src/components/class-schedule/classScheduleWorkspaceUtils.js";

function createPlanWithSessionActual(actual = {}) {
  return {
    version: 2,
    selectedDays: [1],
    globalSessionCount: 2,
    billingPeriods: [
      {
        id: "period-1",
        month: 3,
        startDate: "2026-03-02",
        endDate: "2026-03-09",
      },
    ],
    textbooks: [{ textbookId: "tb-main", order: 0, role: "main" }],
    sessions: [
      {
        id: "session-1",
        billingId: "period-1",
        billingLabel: "3월",
        sessionNumber: 1,
        date: "2026-03-02",
        scheduleState: "active",
        progressStatus: actual.status || "partial",
        textbookEntries: [
          {
            textbookId: "tb-main",
            order: 0,
            role: "main",
            plan: { rangeType: "lessons", label: "Lesson 1" },
            actual: {
              status: "partial",
              rangeType: "lessons",
              label: "Legacy Fallback",
              publicNote: "legacy note",
              ...actual,
            },
          },
        ],
      },
    ],
  };
}

test("buildSessionProgressKey creates a stable session-scoped key", () => {
  assert.equal(
    buildSessionProgressKey("class-1", "session-2", "tb-main"),
    "class-1:session-2:tb-main",
  );
});

test("buildCalendarData returns a valid month grid without throwing", () => {
  const cells = buildCalendarData(
    [
      {
        classItem: { id: "class-1", className: "Calendar Class" },
        sessions: [
          {
            id: "session-1",
            sessionNumber: 1,
            date: "2026-03-02",
            progressStatus: "pending",
            textbookEntries: [{ textbookId: "tb-main", plan: { label: "Lesson 1" }, actual: {} }],
          },
        ],
      },
    ],
    new Date("2026-03-10T00:00:00Z"),
    "month",
  );

  assert.ok(cells.length >= 35);
  assert.equal(cells.some((cell) => cell.key === "2026-03-02"), true);
});

test("createMergedClassScheduleModel prefers progress logs over schedule_plan actual", () => {
  const merged = createMergedClassScheduleModel({
    classItem: {
      id: "class-1",
      className: "중등 영어 A",
      subject: "영어",
      schedule: "월 16:00-17:30",
      textbookIds: ["tb-main"],
      schedulePlan: createPlanWithSessionActual(),
    },
    textbooksCatalog: [{ id: "tb-main", title: "메인 교재" }],
    progressLogs: [
      {
        id: "log-1",
        classId: "class-1",
        textbookId: "tb-main",
        sessionId: "session-1",
        sessionOrder: 1,
        status: "done",
        rangeLabel: "Log Actual",
        publicNote: "from log",
      },
    ],
  });

  assert.equal(merged.sessions[0].progressStatus, "done");
  assert.equal(merged.sessions[0].textbookEntries[0].actual.label, "Log Actual");
  assert.equal(merged.sessions[0].textbookEntries[0].actual.publicNote, "from log");
  assert.equal(merged.sessions[0].textbookEntries[0].textbookTitle, "메인 교재");
});

test("buildClassScheduleWorkspaceData computes plan drift and sync mismatch warnings", () => {
  const classOnePlan = {
    version: 2,
    selectedDays: [1],
    globalSessionCount: 3,
    billingPeriods: [
      {
        id: "period-1",
        month: 3,
        startDate: "2026-03-02",
        endDate: "2026-03-16",
      },
    ],
    textbooks: [{ textbookId: "tb-main", order: 0, role: "main" }],
  };
  const classTwoPlan = {
    ...classOnePlan,
    billingPeriods: [
      {
        id: "period-2",
        month: 3,
        startDate: "2026-03-02",
        endDate: "2026-03-16",
      },
    ],
  };

  const workspace = buildClassScheduleWorkspaceData({
    classes: [
      {
        id: "class-1",
        className: "A반",
        subject: "영어",
        schedule: "월 16:00-17:30",
        teacher: "김선생",
        grade: "중1",
        textbookIds: ["tb-main"],
        termId: "term-1",
        schedulePlan: classOnePlan,
      },
      {
        id: "class-2",
        className: "B반",
        subject: "영어",
        schedule: "월 18:00-19:30",
        teacher: "김선생",
        grade: "중1",
        textbookIds: ["tb-main"],
        termId: "term-1",
        schedulePlan: classTwoPlan,
      },
    ],
    textbooks: [{ id: "tb-main", title: "메인 교재" }],
    progressLogs: [
      {
        id: "log-a1",
        classId: "class-1",
        textbookId: "tb-main",
        sessionId: "session-1",
        sessionOrder: 1,
        status: "done",
      },
      {
        id: "log-b1",
        classId: "class-2",
        textbookId: "tb-main",
        sessionId: "session-1",
        sessionOrder: 1,
        status: "done",
      },
      {
        id: "log-b2",
        classId: "class-2",
        textbookId: "tb-main",
        sessionId: "session-2",
        sessionOrder: 2,
        status: "done",
      },
    ],
    classTerms: [{ id: "term-1", name: "2026 1학기" }],
    syncGroups: [{ id: "group-1", termId: "term-1", name: "영어 동기화" }],
    syncGroupMembers: [
      { groupId: "group-1", classId: "class-1", sortOrder: 0 },
      { groupId: "group-1", classId: "class-2", sortOrder: 1 },
    ],
    filters: {},
    now: "2026-03-16",
  });

  const classOne = workspace.rows.find((row) => row.classItem.id === "class-1");
  assert.equal(classOne.warningSummary.planDrift?.variant, "behind");
  assert.equal(classOne.warningSummary.planDrift?.sessions, 2);
  assert.equal(classOne.warningSummary.syncGap?.sessions, 1);
});

test("restoreClassScheduleViewState normalizes partial preference payloads", () => {
  const restored = restoreClassScheduleViewState({
    view: "table",
    inspectorOpen: false,
    filters: { teacher: "김선생" },
  });

  assert.equal(restored.view, "table");
  assert.equal(restored.timelineZoom, DEFAULT_CLASS_SCHEDULE_VIEW_STATE.timelineZoom);
  assert.equal(restored.density, "compact");
  assert.equal(restored.inspectorOpen, false);
  assert.deepEqual(restored.filters, {
    ...DEFAULT_CLASS_SCHEDULE_VIEW_STATE.filters,
    teacher: "김선생",
  });
});

test("buildSessionProgressLogPayloads expands actual entries into upsert payloads", () => {
  const payloads = buildSessionProgressLogPayloads({
    classItem: {
      id: "class-1",
      className: "중등 영어 A",
      subject: "영어",
      schedule: "월 16:00-17:30",
      textbookIds: ["tb-main"],
    },
    schedulePlan: createPlanWithSessionActual({
      status: "done",
      label: "Lesson 1-2",
      publicNote: "진도 공유",
      teacherNote: "숙제 확인",
    }),
    textbooksCatalog: [{ id: "tb-main", title: "메인 교재" }],
  });

  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].progressKey, "class-1:session-1:tb-main");
  assert.equal(payloads[0].status, "done");
  assert.equal(payloads[0].sessionOrder, 1);
  assert.equal(payloads[0].rangeLabel, "Lesson 1-2");
});

test("createMergedClassScheduleModel keeps generated session ids stable across recalculation", () => {
  const classItem = {
    id: "class-1",
    className: "Middle English A",
    subject: "영어",
    schedule: "Mon 16:00-17:30",
    textbookIds: ["tb-main"],
    schedulePlan: {
      version: 2,
      selectedDays: [1],
      globalSessionCount: 2,
      billingPeriods: [
        {
          id: "period-1",
          month: 3,
          startDate: "2026-03-02",
          endDate: "2026-03-09",
        },
      ],
      textbooks: [{ textbookId: "tb-main", order: 0, role: "main" }],
    },
  };
  const textbooksCatalog = [{ id: "tb-main", title: "Main Textbook" }];

  const firstModel = createMergedClassScheduleModel({
    classItem,
    textbooksCatalog,
    progressLogs: [],
  });

  const secondSessionId = firstModel.sessions[1].id;

  const secondModel = createMergedClassScheduleModel({
    classItem,
    textbooksCatalog,
    progressLogs: [
      {
        classId: "class-1",
        textbookId: "tb-main",
        sessionId: secondSessionId,
        sessionOrder: 2,
        progressKey: buildSessionProgressKey("class-1", secondSessionId, "tb-main"),
        status: "done",
        rangeLabel: "Lesson 2",
      },
    ],
  });

  assert.equal(secondModel.sessions[1].id, secondSessionId);
  assert.equal(secondModel.sessions[0].textbookEntries[0].actual.label, "");
  assert.equal(secondModel.sessions[1].textbookEntries[0].actual.label, "Lesson 2");
});

test("buildClassScheduleWorkspaceData skips malformed classes instead of crashing the whole workspace", () => {
  const brokenClass = {
    id: "broken-class",
    className: "Broken Class",
    subject: "영어",
    teacher: "Kim Teacher",
  };

  Object.defineProperty(brokenClass, "schedulePlan", {
    get() {
      throw new Error("broken schedule plan");
    },
  });

  const workspace = buildClassScheduleWorkspaceData({
    classes: [
      brokenClass,
      {
        id: "healthy-class",
        className: "Healthy Class",
        subject: "영어",
        schedule: "월 16:00-17:30",
        teacher: "Kim Teacher",
        textbookIds: ["tb-main"],
        schedulePlan: {
          version: 2,
          selectedDays: [1],
          globalSessionCount: 1,
          billingPeriods: [
            {
              id: "period-1",
              month: 3,
              startDate: "2026-03-02",
              endDate: "2026-03-02",
            },
          ],
          textbooks: [{ textbookId: "tb-main", order: 0, role: "main" }],
        },
      },
    ],
    textbooks: [{ id: "tb-main", title: "Main Textbook" }],
    progressLogs: [],
    classTerms: [],
    syncGroups: [],
    syncGroupMembers: [],
    filters: {},
    now: "2026-03-02",
  });

  assert.equal(workspace.rows.length, 1);
  assert.equal(workspace.rows[0].classItem.id, "healthy-class");
  assert.equal(workspace.errors.length, 1);
  assert.match(workspace.errors[0].message, /broken schedule plan/);
});
