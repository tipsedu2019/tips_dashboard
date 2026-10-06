import assert from "node:assert/strict";
import test from "node:test";

import { buildDashboardMetrics, getClassExamConflictsForDates } from "../src/features/dashboard/metrics.js";
import { attachDashboardClassSessionDates } from "../src/features/dashboard/session-dates.js";
import {
  attachDashboardWithdrawalRosterCutoffs,
  normalizeDashboardConflictSources,
} from "../src/features/dashboard/snapshot-sources.js";

const lastLessonDate = "2026-10-10";
const sessionDates = [lastLessonDate, "2026-10-11", "2026-10-12"];
const students = [
  { id: "student-1", name: "학생 하나", school: "학교", grade: "고1" },
  { id: "student-2", name: "학생 둘", school: "학교", grade: "고1" },
];
const classes = [
  { id: "class-a", name: "수학 A", subject: "수학", student_ids: ["student-1", "student-2"] },
  { id: "class-b", name: "수학 B", subject: "수학", student_ids: ["student-1"] },
];
const examDays = sessionDates.map((date) => ({
  school: "학교", grade: "고1", subject: "수학", exam_date: date,
}));

function snapshot(extra = {}) {
  return {
    sessionDates: classes.flatMap((classItem) => sessionDates.map((date) => ({
      class_id: classItem.id, session_date: date, schedule_state: "active",
    }))),
    classTerms: [],
    classGroups: [],
    classGroupMembers: [],
    teacherCatalogs: [],
    classroomCatalogs: [],
    academicSchools: [],
    academicExamDays: examDays,
    academicEventExamDetails: [],
    academicEvents: [],
    ...extra,
  };
}

function attachSources(source) {
  return attachDashboardWithdrawalRosterCutoffs(
    attachDashboardClassSessionDates(classes, source.sessionDates),
    source.withdrawalRosterCutoffs,
  );
}

test("authorized dashboard cutoff payload preserves the last lesson and excludes later sessions per student and class", () => {
  const source = normalizeDashboardConflictSources(snapshot({
    withdrawalRosterCutoffs: [
      { studentId: "student-1", classId: "class-a", lastLessonDate },
      { studentId: "student-1", classId: "class-b", lastLessonDate: "2026-10-11" },
      { studentId: "student-2", classId: "unrelated-class", lastLessonDate: "2026-10-09" },
    ],
  }));
  const attached = attachSources(source);
  const metrics = buildDashboardMetrics({
    classes: attached,
    students,
    academicExamDays: source.academicExamDays,
    now: new Date("2026-10-09T00:00:00+09:00"),
  });
  const classA = metrics.examConflicts.find((row) => row.classId === "class-a");
  const classB = metrics.examConflicts.find((row) => row.classId === "class-b");

  assert.deepEqual(classA.conflicts.map((row) => [row.sessionDate, row.studentIds]), [
    [lastLessonDate, ["student-1", "student-2"]],
    ["2026-10-11", ["student-2"]],
    ["2026-10-12", ["student-2"]],
  ]);
  assert.deepEqual(classB.conflicts.map((row) => [row.sessionDate, row.studentIds]), [
    [lastLessonDate, ["student-1"]],
    ["2026-10-11", ["student-1"]],
  ]);
  assert.equal(metrics.registeredEnrollmentCount, 3);
  assert.deepEqual(classes[0].student_ids, ["student-1", "student-2"]);
  assert.equal(classes[0].withdrawalRosterCutoffs, undefined);
  assert.deepEqual(
    metrics.conflictRows.filter((row) => row.type === "exam" && row.classIds.includes("class-a"))
      .map((row) => [row.source.examDate, row.affectedStudentIds]),
    [
      [lastLessonDate, ["student-1", "student-2"]],
      ["2026-10-11", ["student-2"]],
      ["2026-10-12", ["student-2"]],
    ],
  );
});

test("the lesson date controls cutoff inclusion even when its exam is on the following day", () => {
  const source = normalizeDashboardConflictSources(snapshot({
    withdrawalRosterCutoffs: [{ studentId: "student-1", classId: "class-a", lastLessonDate }],
  }));
  const [classA] = attachSources(source);
  const conflicts = getClassExamConflictsForDates(classA, sessionDates, students, [], [
    { school: "학교", grade: "고1", subject: "영어", exam_date: "2026-10-11" },
    { school: "학교", grade: "고1", subject: "과학", exam_date: "2026-10-12" },
  ]);

  assert.deepEqual(conflicts.map((row) => [row.sessionDate, row.examDate, row.rule, row.studentIds]), [
    [lastLessonDate, "2026-10-11", "day-before-other-subject", ["student-1", "student-2"]],
    ["2026-10-11", "2026-10-12", "day-before-other-subject", ["student-2"]],
  ]);
});

test("an older conflict RPC without withdrawal cutoffs retains all existing conflict behavior", () => {
  const source = normalizeDashboardConflictSources(snapshot());
  assert.deepEqual(source.withdrawalRosterCutoffs, []);
  const [classA] = attachSources(source);
  const conflicts = getClassExamConflictsForDates(classA, sessionDates, students, [], examDays);

  assert.deepEqual(conflicts.map((row) => row.studentIds), [
    ["student-1", "student-2"], ["student-1", "student-2"], ["student-1", "student-2"],
  ]);
});

test("cutoff normalization and attachment retain only the authorized date projection", () => {
  const source = normalizeDashboardConflictSources(snapshot({
    withdrawalRosterCutoffs: [{
      studentId: "student-1", classId: "class-a", lastLessonDate,
      queueId: "private-queue", taskId: "private-task", claimId: "private-claim",
    }],
    queue: [{ id: "private-queue" }],
  }));

  assert.deepEqual(source.withdrawalRosterCutoffs, [{ studentId: "student-1", classId: "class-a", lastLessonDate }]);
  assert.deepEqual(attachSources(source)[0].withdrawalRosterCutoffs, { "student-1": lastLessonDate });
  assert.doesNotMatch(JSON.stringify(source), /private-|queueId|taskId|claimId/);
});

test("a present malformed cutoff payload reports a source format error", () => {
  for (const withdrawalRosterCutoffs of [
    null,
    {},
    [null],
    [{ classId: "class-a", studentId: "student-1" }],
    [{ classId: "class-a", studentId: "student-1", lastLessonDate: "tomorrow" }],
    [{ classId: "", studentId: "student-1", lastLessonDate }],
  ]) {
    assert.throws(
      () => normalizeDashboardConflictSources(snapshot({ withdrawalRosterCutoffs })),
      /대시보드 데이터 형식을 확인하지 못했습니다\./,
    );
  }
});

function weeklyMetrics(cutoffs, now) {
  const weeklyClasses = [
    {
      id: "class-a", name: "수학 A", subject: "수학", schedule: "월 10:00-11:00",
      teacher: "담당 선생님", classroom: "1강", student_ids: ["student-1", "student-2", "student-3"],
    },
    {
      id: "class-b", name: "수학 B", subject: "수학", schedule: "월 10:30-11:30",
      teacher: "담당 선생님", classroom: "1강", student_ids: ["student-1", "student-2", "student-3"],
    },
    {
      id: "unrelated-class", name: "수학 C", subject: "수학", schedule: "화 10:00-11:00",
      teacher: "다른 선생님", classroom: "2강", student_ids: ["student-1"],
    },
  ];
  return buildDashboardMetrics({
    classes: attachDashboardWithdrawalRosterCutoffs(weeklyClasses, cutoffs),
    students: [...students, { id: "student-3", name: "학생 셋" }],
    now: new Date(now),
  });
}

test("weekly student conflicts include the next occurrence on the last lesson date in both classes", () => {
  const metrics = weeklyMetrics([
    { classId: "class-a", studentId: "student-1", lastLessonDate: "2026-10-12" },
    { classId: "class-b", studentId: "student-1", lastLessonDate: "2026-10-12" },
  ], "2026-10-11T15:30:00Z");
  const studentRows = metrics.conflictRows.filter((row) => row.type === "student");

  assert.equal(studentRows.length, 3);
  assert.equal(studentRows.find((row) => row.affectedStudentIds.includes("student-1")).nextOccurrenceAt,
    "2026-10-12T10:30:00+09:00");
});

test("weekly student conflicts exclude a later occurrence when either class cutoff has passed and preserve resources", () => {
  const now = "2026-10-11T09:00:00+09:00";
  const baseline = weeklyMetrics([], now);
  const metrics = weeklyMetrics([
    { classId: "class-a", studentId: "student-1", lastLessonDate: "2026-10-11" },
    { classId: "class-b", studentId: "student-2", lastLessonDate: "2026-10-11" },
    { classId: "unrelated-class", studentId: "student-3", lastLessonDate: "2026-10-10" },
  ], now);
  const studentRows = metrics.conflictRows.filter((row) => row.type === "student");
  const resourceRows = (value) => value.conflictRows.filter((row) => ["teacher", "classroom"].includes(row.type));

  assert.deepEqual(studentRows.map((row) => row.affectedStudentIds), [["student-3"]]);
  assert.equal(studentRows[0].nextOccurrenceAt, "2026-10-12T10:30:00+09:00");
  assert.deepEqual(studentRows[0].source.studentIds, ["student-3"]);
  assert.deepEqual(resourceRows(metrics), resourceRows(baseline));
  assert.deepEqual(resourceRows(metrics).map((row) => row.type), ["teacher", "classroom"]);
  assert.equal(metrics.registeredEnrollmentCount, baseline.registeredEnrollmentCount);
  assert.equal(metrics.registeredEnrollmentCount, 7);
});

test("weekly student conflicts use the next occurrence date after today's overlap time has passed", () => {
  const metrics = weeklyMetrics([
    { classId: "class-a", studentId: "student-1", lastLessonDate: "2026-10-12" },
    { classId: "class-b", studentId: "student-2", lastLessonDate: "2026-10-12" },
    { classId: "class-a", studentId: "student-3", lastLessonDate: "2026-10-12" },
  ], "2026-10-12T11:00:00+09:00");

  assert.deepEqual(metrics.conflictRows.filter((row) => row.type === "student"), []);
  assert.equal(metrics.conflictRows.filter((row) => row.type === "teacher")[0].nextOccurrenceAt,
    "2026-10-19T10:30:00+09:00");
  assert.equal(metrics.conflictRows.filter((row) => row.type === "classroom").length, 1);
});
