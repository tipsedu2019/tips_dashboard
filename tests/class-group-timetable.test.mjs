import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCurriculumWorkspaceModel,
  buildTimetableWorkspaceModel,
} from "../src/features/academic/records.js";

test("timetable rows can be filtered by many-to-many class groups", () => {
  const workspace = buildTimetableWorkspaceModel({
    classes: [
      {
        id: "class-a",
        name: "고1 공통수학",
        subject: "수학",
        grade: "고1",
        teacher: "김성은",
        classroom: "본관 2강",
        schedule: "금 10:00-11:00",
        status: "수강",
      },
      {
        id: "class-b",
        name: "고1 영어",
        subject: "영어",
        grade: "고1",
        teacher: "한지현",
        classroom: "별관 4강",
        schedule: "수 12:00-13:00",
        status: "수강",
      },
    ],
    classGroups: [
      { id: "group-2026-1", name: "2026 1학기", sort_order: 1 },
      { id: "group-inner", name: "내신 집중", sort_order: 2 },
    ],
    classGroupMembers: [
      { group_id: "group-2026-1", class_id: "class-a" },
      { group_id: "group-inner", class_id: "class-a" },
      { group_id: "group-inner", class_id: "class-b" },
    ],
    filters: {
      classGroupId: "group-2026-1",
      status: "수강",
    },
  });

  assert.equal(workspace.rows.length, 1);
  assert.equal(workspace.rows[0].classId, "class-a");
  assert.deepEqual(workspace.rows[0].classGroupIds, ["group-2026-1", "group-inner"]);
  assert.deepEqual(
    workspace.classGroupOptions.map((option) => option.label),
    ["2026 1학기", "내신 집중"],
  );
});

test("duplicate period labels collapse into one option and filter through every alias", () => {
  const classes = [
    {
      id: "math-main",
      name: "고1 공통수학",
      subject: "수학",
      grade: "고1",
      teacher: "양소윤",
      classroom: "별관 7강",
      schedule: "금 21:30-23:00",
      status: "수강",
    },
    {
      id: "english-legacy",
      name: "대기고3",
      subject: "영어",
      grade: "고3",
      teacher: "강부희",
      classroom: "별관 4강",
      schedule: "수 21:30-23:30",
      status: "수강",
    },
  ];
  const classGroups = [
    { id: "period-main", name: "2026 1학기", sort_order: 1 },
    { id: "period-duplicate", name: "2026 1학기", sort_order: 2 },
  ];
  const classGroupMembers = [
    { group_id: "period-main", class_id: "math-main" },
    { group_id: "period-duplicate", class_id: "english-legacy" },
  ];

  const timetable = buildTimetableWorkspaceModel({
    classes,
    classGroups,
    classGroupMembers,
    filters: { classGroupId: "period-main" },
  });
  const curriculum = buildCurriculumWorkspaceModel({
    classes,
    classGroups,
    classGroupMembers,
    filters: { classGroupId: "period-main" },
  });

  assert.equal(timetable.classGroupOptions.length, 1);
  assert.equal(timetable.classGroupOptions[0].label, "2026 1학기");
  assert.deepEqual(timetable.classGroupOptions[0].aliases, [
    "period-main",
    "2026 1학기",
    "period-duplicate",
  ]);
  assert.deepEqual(
    timetable.rows.map((row) => row.classId).sort(),
    ["english-legacy", "math-main"],
  );
  assert.deepEqual(
    curriculum.rows.map((row) => row.id).sort(),
    ["english-legacy", "math-main"],
  );
});

test("status filter includes ended classes when the user chooses 종강", () => {
  const workspace = buildTimetableWorkspaceModel({
    classes: [
      {
        id: "ended-class",
        name: "종강 수업",
        subject: "영어",
        grade: "고3",
        academic_year: "2026",
        period: "2학기",
        teacher: "강부희",
        classroom: "별관 4강",
        schedule: "수 18:00-19:00",
        status: "종강",
      },
    ],
    filters: {
      status: "종강",
    },
  });

  assert.equal(workspace.rows.length, 1);
  assert.equal(workspace.rows[0].statusFilter, "종강");
});

test("timetable rows can be filtered by subject", () => {
  const workspace = buildTimetableWorkspaceModel({
    classes: [
      {
        id: "math-class",
        name: "고1 수학",
        subject: "수학",
        grade: "고1",
        teacher: "김성은",
        classroom: "본관 2강",
        schedule: "금 21:30-23:00",
        status: "수강",
      },
      {
        id: "english-class",
        name: "고1 영어",
        subject: "영어",
        grade: "고1",
        teacher: "한지현",
        classroom: "별관 4강",
        schedule: "수 19:30-21:30",
        status: "수강",
      },
    ],
    filters: {
      status: "수강",
      subject: "영어",
    },
  });

  assert.deepEqual(workspace.rows.map((row) => row.classId), ["english-class"]);
  assert.deepEqual(workspace.subjectOptions, ["수학", "영어"]);
  assert.deepEqual(workspace.teacherOptions, ["한지현"]);
  assert.deepEqual(workspace.classroomOptions, ["별관 4강"]);
});

test("classes without explicit groups fall back to a combined year and term group", () => {
  const workspace = buildTimetableWorkspaceModel({
    classes: [
      {
        id: "fallback-class",
        name: "고3 영어",
        subject: "영어",
        grade: "고3",
        academic_year: "2026",
        period: "1학기",
        teacher: "강부희",
        classroom: "별관 4강",
        schedule: "목 18:00-19:00",
        status: "수강",
      },
    ],
    filters: {
      status: "수강",
    },
  });

  assert.equal(workspace.rows[0].classGroupLabel, "2026 1학기");
  assert.deepEqual(workspace.classGroupOptions, [
    {
      value: "term:2026:1학기",
      label: "2026 1학기",
      aliases: ["term:2026:1학기", "2026 1학기"],
    },
  ]);
});
